import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import axios from "axios"

import { type ModelInfo, openAiModelInfoSaneDefaults, LMSTUDIO_DEFAULT_TEMPERATURE } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { NativeToolCallParser } from "../../core/assistant-message/NativeToolCallParser"
import { TagMatcher } from "../../utils/tag-matcher"

import { convertToOpenAiMessages } from "../transform/openai-format"
import { getModelParams } from "../transform/model-params"
import { ApiStream } from "../transform/stream"

import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata, CompletePromptOptions } from "../index"
import { getModelsFromCache } from "./fetchers/modelCache"
import { handleOpenAIError } from "./utils/error-handler"
import { extractReasoningFromDelta } from "./utils/extract-reasoning"

export class LmStudioHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI
	private readonly providerName = "LM Studio"

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		// LM Studio uses "noop" as a placeholder API key
		const apiKey = "noop"

		this.client = new OpenAI({
			baseURL: (this.options.lmStudioBaseUrl || "http://localhost:1234") + "/v1",
			apiKey: apiKey,
			timeout: this.timeoutMs,
		})
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { id: model, info } = this.getModel()
		const modelParams = getModelParams({
			format: "openai",
			modelId: model,
			model: info,
			settings: this.options,
			reasoningEffort: metadata?.reasoningEffort,
			defaultTemperature: LMSTUDIO_DEFAULT_TEMPERATURE,
		})

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// -------------------------
		// Track token usage
		// -------------------------
		const toContentBlocks = (
			blocks: Anthropic.Messages.MessageParam[] | string,
		): Anthropic.Messages.ContentBlockParam[] => {
			if (typeof blocks === "string") {
				return [{ type: "text", text: blocks }]
			}

			const result: Anthropic.Messages.ContentBlockParam[] = []
			for (const msg of blocks) {
				if (typeof msg.content === "string") {
					result.push({ type: "text", text: msg.content })
				} else if (Array.isArray(msg.content)) {
					for (const part of msg.content) {
						if (part.type === "text") {
							result.push({ type: "text", text: part.text })
						}
					}
				}
			}
			return result
		}

		let inputTokens = 0
		try {
			inputTokens = await this.countTokens([{ type: "text", text: systemPrompt }, ...toContentBlocks(messages)])
		} catch (err) {
			console.error("[LmStudio] Failed to count input tokens:", err)
			inputTokens = 0
		}

		let assistantText = ""

		try {
			const params: OpenAI.Chat.ChatCompletionCreateParamsStreaming & { draft_model?: string } = {
				model,
				messages: openAiMessages,
				temperature: this.options.modelTemperature ?? LMSTUDIO_DEFAULT_TEMPERATURE,
				stream: true,
				tools: this.convertToolsForOpenAI(metadata?.tools),
				tool_choice: metadata?.tool_choice,
				parallel_tool_calls: metadata?.parallelToolCalls ?? true,
				...(modelParams.reasoningEffort
					? {
							reasoning_effort: modelParams.reasoningEffort as OpenAI.Chat.ChatCompletionCreateParams["reasoning_effort"],
						}
					: {}),
			}

			if (this.options.lmStudioSpeculativeDecodingEnabled && this.options.lmStudioDraftModelId) {
				params.draft_model = this.options.lmStudioDraftModelId
			}

			let results
			try {
				results = await this.client.chat.completions.create(params, { signal: metadata?.abortSignal })
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			const matcher = new TagMatcher(
				["think", "thought"],
				(chunk) =>
					({
						type: chunk.matched ? "reasoning" : "text",
						text: chunk.data,
					}) as const,
			)

			// Some models loaded in LM Studio don't reliably emit real `tool_calls`, even when
			// `tools` is passed - they write the tool call as plain text instead (bare JSON,
			// self-closing XML, XML wrapping JSON, or the legacy multi-child-tag XML format),
			// sometimes copying a tool description's example verbatim. While no real tool call
			// has been seen yet, buffer text that could be such a call so it can be routed through
			// the normal tool pipeline instead of displayed as raw text/markup.
			let fallbackCandidateBuffer: string | null = null
			let sawRealToolCall = false
			let fallbackToolCallId = 0

			// A model illustrating tool-call syntax in prose (e.g. "you'd write { ... }") almost
			// always does so mid-explanation, not as the very first thing it says - and scoping
			// detection to offeredTools doesn't help distinguish that case, since the example
			// syntax typically names a real offered tool. Restricting detection to the first text
			// chunk of the message keeps the fallback narrowly targeted at models that emit an
			// actual tool call as their entire plain-text response.
			let isFirstTextChunk = true

			// Caps how long a buffered fallback candidate can grow before it's force-flushed as
			// plain text, so a legitimately long, unrelated `{`/`<`-leading block of prose or code
			// (e.g. inside a fenced code sample) is never withheld from the UI indefinitely.
			const MAX_FALLBACK_BUFFER_LENGTH = 4000

			// Incremental scan state for the JSON-shaped candidate ("{"-prefixed), so each chunk
			// only scans the text appended since the previous chunk instead of rescanning the
			// whole buffer from index 0 every time (which turns a long streamed candidate into
			// O(n^2) work). Reset alongside fallbackCandidateBuffer via resetFallbackBuffer().
			let jsonScanState: {
				depth: number
				inString: boolean
				escaped: boolean
				started: boolean
				closedAt: number
			} | null = null
			let jsonScannedLength = 0

			const resetFallbackBuffer = () => {
				fallbackCandidateBuffer = null
				jsonScanState = null
				jsonScannedLength = 0
			}

			const scanJsonIncremental = (buffer: string): "incomplete" | "balanced" | "invalid" => {
				if (!jsonScanState) {
					jsonScanState = { depth: 0, inString: false, escaped: false, started: false, closedAt: -1 }
					jsonScannedLength = 0
				}
				const state = jsonScanState

				for (let i = jsonScannedLength; i < buffer.length; i++) {
					const char = buffer[i]

					if (state.closedAt !== -1) {
						if (!/\s/.test(char)) {
							jsonScannedLength = buffer.length
							return "invalid"
						}
						continue
					}

					if (state.inString) {
						if (state.escaped) {
							state.escaped = false
						} else if (char === "\\") {
							state.escaped = true
						} else if (char === '"') {
							state.inString = false
						}
						continue
					}

					if (char === '"') {
						state.inString = true
					} else if (char === "{") {
						state.depth++
						state.started = true
					} else if (char === "}") {
						state.depth--
						if (state.depth < 0) {
							jsonScannedLength = buffer.length
							return "invalid"
						}
						if (state.depth === 0 && state.started) {
							state.closedAt = i
						}
					}
				}

				jsonScannedLength = buffer.length
				return state.closedAt !== -1 ? "balanced" : "incomplete"
			}

			// Scope fallback detection to the tools actually offered for this request (and, when
			// the current mode further restricts which tools can be invoked, to that subset).
			// Matching against the full tool registry would risk converting a model's illustrative
			// example of unrelated tool syntax (e.g. while explaining how a tool works in a
			// restricted/explain-only mode) into a real tool call attempt.
			const offeredTools = (metadata?.tools ?? []).filter(
				(tool) =>
					tool.type === "function" &&
					(!metadata?.allowedFunctionNames || metadata.allowedFunctionNames.includes(tool.function.name)),
			)

			const handleTextChunk = function* (processedChunk: { type: "reasoning" | "text"; text: string }) {
				if (processedChunk.type !== "text" || sawRealToolCall) {
					yield processedChunk
					return
				}

				if (!isFirstTextChunk) {
					yield processedChunk
					return
				}

				const buffer = (fallbackCandidateBuffer ?? "") + processedChunk.text
				const trimmedStart = buffer.replace(/^\s+/, "")

				if (trimmedStart.length === 0) {
					fallbackCandidateBuffer = buffer
					return
				}

				if (trimmedStart[0] !== "{" && trimmedStart[0] !== "<") {
					resetFallbackBuffer()
					isFirstTextChunk = false
					yield { type: "text", text: buffer } as const
					return
				}

				const status =
					trimmedStart[0] === "{" ? scanJsonIncremental(buffer) : NativeToolCallParser.getBufferStatus(buffer)

				if (status === "incomplete") {
					if (buffer.length > MAX_FALLBACK_BUFFER_LENGTH) {
						// Never held-back forever: a legitimate long block that happens to start
						// with "{"/"<" gets flushed once it's clearly not closing any time soon.
						resetFallbackBuffer()
						isFirstTextChunk = false
						yield { type: "text", text: buffer } as const
						return
					}
					fallbackCandidateBuffer = buffer
					return
				}

				resetFallbackBuffer()
				isFirstTextChunk = false

				if (status === "balanced") {
					const detected = NativeToolCallParser.detectToolCallAttempt(buffer, offeredTools)
					if (detected) {
						yield {
							type: "tool_call",
							id: `lmstudio-fallback-${++fallbackToolCallId}`,
							name: detected.name,
							arguments: detected.arguments,
						} as const
						return
					}
				}

				// Invalid, or balanced but not a recognized tool shape - show as plain text.
				yield { type: "text", text: buffer } as const
			}

			for await (const chunk of results) {
				const delta = chunk.choices[0]?.delta
				const finishReason = chunk.choices[0]?.finish_reason

				if (delta?.tool_calls) {
					sawRealToolCall = true
					if (fallbackCandidateBuffer) {
						assistantText += fallbackCandidateBuffer
						yield { type: "text", text: fallbackCandidateBuffer }
						resetFallbackBuffer()
					}
				}

				if (delta?.content) {
					assistantText += delta.content
					for (const processedChunk of matcher.update(delta.content)) {
						for (const outputChunk of handleTextChunk(processedChunk)) {
							yield outputChunk
						}
					}
				}

				// Some models loaded in LM Studio emit reasoning as a structured
				// `reasoning`/`reasoning_content` delta field instead of (or in addition to)
				// inline <think>/<thought> tags - catch that format too, matching how other
				// OpenAI-compatible providers on this branch handle it.
				const reasoningText = extractReasoningFromDelta(delta)
				if (reasoningText) {
					yield { type: "reasoning", text: reasoningText }
				}

				// Handle tool calls in stream - emit partial chunks for NativeToolCallParser
				if (delta?.tool_calls) {
					for (const toolCall of delta.tool_calls) {
						yield {
							type: "tool_call_partial",
							index: toolCall.index,
							id: toolCall.id,
							name: toolCall.function?.name,
							arguments: toolCall.function?.arguments,
						}
					}
				}

				// Process finish_reason to emit tool_call_end events
				if (finishReason) {
					const endEvents = NativeToolCallParser.processFinishReason(finishReason)
					for (const event of endEvents) {
						yield event
					}
				}
			}

			for (const processedChunk of matcher.final()) {
				for (const outputChunk of handleTextChunk(processedChunk)) {
					yield outputChunk
				}
			}

			// Stream ended while still buffering a candidate that never closed - flush as plain text.
			if (fallbackCandidateBuffer) {
				yield { type: "text", text: fallbackCandidateBuffer }
				fallbackCandidateBuffer = null
			}

			let outputTokens = 0
			try {
				outputTokens = await this.countTokens([{ type: "text", text: assistantText }])
			} catch (err) {
				console.error("[LmStudio] Failed to count output tokens:", err)
				outputTokens = 0
			}

			yield {
				type: "usage",
				inputTokens,
				outputTokens,
			} as const
		} catch (error) {
			throw new Error(
				"Please check the LM Studio developer logs to debug what went wrong. You may need to load the model with a larger context length to work with Zoo Code's prompts.",
			)
		}
	}

	override getModel(): { id: string; info: ModelInfo } {
		const models = getModelsFromCache({
			provider: "lmstudio",
			baseUrl: this.options.lmStudioBaseUrl,
		})
		if (models && this.options.lmStudioModelId && models[this.options.lmStudioModelId]) {
			return {
				id: this.options.lmStudioModelId,
				info: models[this.options.lmStudioModelId],
			}
		} else {
			return {
				id: this.options.lmStudioModelId || "",
				info: openAiModelInfoSaneDefaults,
			}
		}
	}

	async completePrompt(prompt: string, options?: CompletePromptOptions): Promise<string> {
		try {
			const { id: model, info } = this.getModel()
			const modelParams = getModelParams({
				format: "openai",
				modelId: model,
				model: info,
				settings: this.options,
				reasoningEffort: options?.reasoningEffort,
				defaultTemperature: LMSTUDIO_DEFAULT_TEMPERATURE,
			})

			// Create params object with optional draft model
			const params: any = {
				model,
				messages: [{ role: "user", content: prompt }],
				temperature: this.options.modelTemperature ?? LMSTUDIO_DEFAULT_TEMPERATURE,
				stream: false,
				...(modelParams.reasoningEffort ? { reasoning_effort: modelParams.reasoningEffort } : {}),
			}

			// Add draft model if speculative decoding is enabled and a draft model is specified
			if (this.options.lmStudioSpeculativeDecodingEnabled && this.options.lmStudioDraftModelId) {
				params.draft_model = this.options.lmStudioDraftModelId
			}

			let response
			try {
				response = await this.client.chat.completions.create(params, { signal: options?.abortSignal })
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}
			return response.choices[0]?.message.content || ""
		} catch (error) {
			throw new Error(
				"Please check the LM Studio developer logs to debug what went wrong. You may need to load the model with a larger context length to work with Zoo Code's prompts.",
			)
		}
	}
}

export async function getLmStudioModels(baseUrl = "http://localhost:1234") {
	try {
		if (!URL.canParse(baseUrl)) {
			return []
		}

		const response = await axios.get(`${baseUrl}/v1/models`)
		const modelsArray = response.data?.data?.map((model: any) => model.id) || []
		return [...new Set<string>(modelsArray)]
	} catch (error) {
		return []
	}
}
