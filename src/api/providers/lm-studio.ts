import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import axios from "axios"

import { type ModelInfo, openAiModelInfoSaneDefaults, LMSTUDIO_DEFAULT_TEMPERATURE } from "@bro-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { NativeToolCallParser } from "../../core/assistant-message/NativeToolCallParser"
import { TagMatcher } from "../../utils/tag-matcher"

import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { getModelsFromCache } from "./fetchers/modelCache"
import { handleOpenAIError } from "./utils/openai-error-handler"
import { getLmStudioFetchConfig } from "./utils/lmstudio-proxy"

export class LmStudioHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI
	private readonly providerName = "LM Studio"

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		// LM Studio uses "noop" as a placeholder API key
		const apiKey = "noop"

		// undici (Node's fetch implementation) defaults headersTimeout/bodyTimeout to 5 minutes,
		// which silently aborts requests to slow local models well before our own timeoutMs is
		// reached (e.g. long prompt-processing on large contexts with no bytes sent yet).
		const { dispatcher, fetch: lmStudioFetch } = getLmStudioFetchConfig(this.options, this.timeoutMs)

		this.client = new OpenAI({
			baseURL: (this.options.lmStudioBaseUrl || "http://localhost:1234") + "/v1",
			apiKey: apiKey,
			timeout: this.timeoutMs,
			fetchOptions: { dispatcher },
			// VS Code patches `globalThis.fetch` in the extension host to honor the user's
			// configured `http.proxy`/system proxy. For a local/LAN LM Studio server that proxy
			// is often the wrong route (and may reject it outright), so when the user opts in we
			// bypass it by calling undici's fetch directly instead of the patched global one.
			// The same bypass is needed when a custom proxy URL is set, so requests are routed
			// through the user-defined proxy instead of VS Code's system proxy.
			...(lmStudioFetch ? { fetch: lmStudioFetch } : {}),
		})
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
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
				model: this.getModel().id,
				messages: openAiMessages,
				temperature: this.options.modelTemperature ?? LMSTUDIO_DEFAULT_TEMPERATURE,
				stream: true,
				tools: this.convertToolsForOpenAI(metadata?.tools),
				tool_choice: metadata?.tool_choice,
				parallel_tool_calls: metadata?.parallelToolCalls ?? true,
			}

			if (this.options.lmStudioSpeculativeDecodingEnabled && this.options.lmStudioDraftModelId) {
				params.draft_model = this.options.lmStudioDraftModelId
			}

			let results
			try {
				results = await this.client.chat.completions.create(params)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			const matcher = new TagMatcher(
				"think",
				(chunk) =>
					({
						type: chunk.matched ? "reasoning" : "text",
						text: chunk.data,
					}) as const,
			)

			// Some models loaded in LM Studio don't reliably emit real `tool_calls`, even when
			// `tools` is passed - they write the bare JSON arguments object as plain text instead
			// (sometimes copying a tool description's example verbatim). While no real tool call
			// has been seen yet, buffer text that could be such a JSON object so it can be routed
			// through the normal tool pipeline instead of displayed as raw JSON.
			// Defaults to enabled; users can turn it off in Providers > Advanced settings if it
			// ever misfires on a model that legitimately returns bare JSON as its answer.
			const jsonToolCallFallbackEnabled = this.options.lmStudioJsonToolCallFallbackEnabled !== false
			let jsonCandidateBuffer: string | null = null
			let sawRealToolCall = false
			let fallbackToolCallId = 0

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
				if (!jsonToolCallFallbackEnabled || processedChunk.type !== "text" || sawRealToolCall) {
					yield processedChunk
					return
				}

				const buffer = (jsonCandidateBuffer ?? "") + processedChunk.text
				const trimmedStart = buffer.replace(/^\s+/, "")

				if (trimmedStart.length === 0) {
					jsonCandidateBuffer = buffer
					return
				}

				if (trimmedStart[0] !== "{" && trimmedStart[0] !== "<") {
					jsonCandidateBuffer = null
					yield { type: "text", text: buffer } as const
					return
				}

				const status = NativeToolCallParser.getBufferStatus(buffer)

				if (status === "incomplete") {
					jsonCandidateBuffer = buffer
					return
				}

				jsonCandidateBuffer = null

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
					if (jsonCandidateBuffer) {
						assistantText += jsonCandidateBuffer
						yield { type: "text", text: jsonCandidateBuffer }
						jsonCandidateBuffer = null
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
			if (jsonCandidateBuffer) {
				yield { type: "text", text: jsonCandidateBuffer }
				jsonCandidateBuffer = null
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
			const reason = error instanceof Error ? error.message : String(error)
			throw new Error(
				`LM Studio request failed: ${reason}\nPlease check the LM Studio developer logs to debug what went wrong. You may need to load the model with a larger context length to work with Bro Code's prompts.`,
			)
		}
	}

	override getModel(): { id: string; info: ModelInfo } {
		const models = getModelsFromCache("lmstudio")
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

	async completePrompt(prompt: string): Promise<string> {
		try {
			// Create params object with optional draft model
			const params: any = {
				model: this.getModel().id,
				messages: [{ role: "user", content: prompt }],
				temperature: this.options.modelTemperature ?? LMSTUDIO_DEFAULT_TEMPERATURE,
				stream: false,
			}

			// Add draft model if speculative decoding is enabled and a draft model is specified
			if (this.options.lmStudioSpeculativeDecodingEnabled && this.options.lmStudioDraftModelId) {
				params.draft_model = this.options.lmStudioDraftModelId
			}

			let response
			try {
				response = await this.client.chat.completions.create(params)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}
			return response.choices[0]?.message.content || ""
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error)
			throw new Error(
				`LM Studio request failed: ${reason}\nPlease check the LM Studio developer logs to debug what went wrong. You may need to load the model with a larger context length to work with Bro Code's prompts.`,
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
