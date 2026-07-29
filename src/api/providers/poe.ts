import { Anthropic } from "@anthropic-ai/sdk"
import { createPoe, type PoeProvider, type PoeScopedProviderOptions } from "ai-sdk-provider-poe"
import { extractUsageMetrics, mapToolChoice } from "ai-sdk-provider-poe/code"
import { streamText, generateText, type ToolSet } from "ai"

import {
	poeDefaultModelId,
	getPoeDefaultModelInfo,
	type ModelInfo,
	type ReasoningEffortExtended,
	ApiProviderError,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import {
	resolveReasoningSettings,
	shouldUseReasoningBudget,
	shouldUseReasoningEffort,
	type ApiHandlerOptions,
} from "../../shared/api"

import { convertToAiSdkMessages, convertToolsForAiSdk, processAiSdkStreamPart } from "../transform/ai-sdk"
import { ApiStream } from "../transform/stream"

import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata, CompletePromptOptions } from "../index"
import { getModelsFromCache } from "./fetchers/modelCache"

const DEFAULT_THINKING_BUDGET = 8192

export class PoeHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private poe: PoeProvider

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		this.poe = createPoe({
			apiKey: options.poeApiKey ?? "not-provided",
			baseURL: options.poeBaseUrl || undefined,
		})
	}

	override getModel() {
		const id = this.options.apiModelId ?? poeDefaultModelId
		const cached = getModelsFromCache({
			provider: "poe",
			apiKey: this.options.poeApiKey,
			baseUrl: this.options.poeBaseUrl,
		})
		const info: ModelInfo = cached?.[id] ?? getPoeDefaultModelInfo()
		return { id, info }
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { id, info } = this.getModel()
		const languageModel = this.poe(id)

		const aiSdkMessages = convertToAiSdkMessages(messages)
		const openAiTools = this.convertToolsForOpenAI(metadata?.tools)
		const aiSdkTools = convertToolsForAiSdk(openAiTools) as ToolSet | undefined

		const requestSettings = resolveReasoningSettings({
			model: info,
			settings: this.options,
			reasoningEffort: metadata?.reasoningEffort,
		})
		const useBudget = shouldUseReasoningBudget({ model: info, settings: requestSettings })
		const useEffort = !useBudget && shouldUseReasoningEffort({ model: info, settings: requestSettings })

		// Only pass temperature when the user explicitly configured it.
		let temperature: number | undefined = this.options.modelTemperature ?? undefined
		let maxOutputTokens: number | undefined
		const providerOptions: NonNullable<Parameters<typeof streamText>[0]["providerOptions"]> & {
			poe?: PoeScopedProviderOptions
		} = {}

		if (useBudget) {
			const requestedBudget = this.options.modelMaxThinkingTokens ?? DEFAULT_THINKING_BUDGET
			// maxOutputTokens is the text-only budget; reasoningBudgetTokens is
			// separate, so total output = maxOutputTokens + reasoningBudgetTokens.
			maxOutputTokens = this.options.modelMaxTokens ?? Math.max(0, (info.maxTokens ?? 0) - requestedBudget)
			providerOptions.poe = {
				reasoningBudgetTokens: requestedBudget,
			}
			temperature = 1.0
		} else if (useEffort) {
			let effort = (requestSettings.reasoningEffort ?? info.reasoningEffort ?? "medium") as ReasoningEffortExtended
			// Validate that the effort level is actually supported by the current model
			const supportedEfforts = info.supportsReasoningEffort
			if (Array.isArray(supportedEfforts) && !supportedEfforts.includes(effort as any)) {
				effort = (info.reasoningEffort as ReasoningEffortExtended) ?? "medium"
			}
			providerOptions.poe = {
				reasoningEffort: effort,
				reasoningSummary: "auto",
			}
			if (this.options.modelMaxTokens) {
				maxOutputTokens = this.options.modelMaxTokens
			}
		}

		let result
		try {
			result = streamText({
				model: languageModel,
				system: systemPrompt,
				messages: aiSdkMessages,
				temperature,
				maxOutputTokens,
				tools: aiSdkTools,
				toolChoice: mapToolChoice(metadata?.tool_choice as any),
				...(Object.keys(providerOptions).length > 0 && { providerOptions }),
			})
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			TelemetryService.instance.captureException(new ApiProviderError(errorMessage, "poe", id, "createMessage"))
			throw new Error(`Poe completion error: ${errorMessage}`)
		}

		try {
			for await (const part of result.fullStream) {
				for (const chunk of processAiSdkStreamPart(part)) {
					yield chunk
				}
			}

			const usage = await result.usage
			if (usage) {
				const metrics = extractUsageMetrics(usage as any)
				yield {
					type: "usage" as const,
					inputTokens: metrics.inputTokens,
					outputTokens: metrics.outputTokens,
					cacheReadTokens: metrics.cacheReadTokens,
					cacheWriteTokens: metrics.cacheWriteTokens,
					reasoningTokens: metrics.reasoningTokens,
				}
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			TelemetryService.instance.captureException(new ApiProviderError(errorMessage, "poe", id, "createMessage"))
			throw new Error(`Poe streaming error: ${errorMessage}`)
		}
	}

	async completePrompt(prompt: string, options?: CompletePromptOptions): Promise<string> {
		const { id, info } = this.getModel()
		try {
			const requestSettings = resolveReasoningSettings({
				model: info,
				settings: this.options,
				reasoningEffort: options?.reasoningEffort,
			})
			const useBudget = shouldUseReasoningBudget({ model: info, settings: requestSettings })
			const useEffort = !useBudget && shouldUseReasoningEffort({ model: info, settings: requestSettings })
			let temperature: number | undefined = this.options.modelTemperature ?? undefined
			let maxOutputTokens: number | undefined
			const providerOptions: NonNullable<Parameters<typeof generateText>[0]["providerOptions"]> & {
				poe?: PoeScopedProviderOptions
			} = {}

			if (useBudget) {
				const requestedBudget = this.options.modelMaxThinkingTokens ?? DEFAULT_THINKING_BUDGET
				maxOutputTokens = this.options.modelMaxTokens ?? Math.max(0, (info.maxTokens ?? 0) - requestedBudget)
				providerOptions.poe = { reasoningBudgetTokens: requestedBudget }
				temperature = 1.0
			} else if (useEffort) {
				let effort = (requestSettings.reasoningEffort ?? info.reasoningEffort ?? "medium") as ReasoningEffortExtended
				const supportedEfforts = info.supportsReasoningEffort
				if (Array.isArray(supportedEfforts) && !supportedEfforts.includes(effort as any)) {
					effort = (info.reasoningEffort as ReasoningEffortExtended) ?? "medium"
				}
				providerOptions.poe = { reasoningEffort: effort, reasoningSummary: "auto" }
				maxOutputTokens = this.options.modelMaxTokens || undefined
			}

			const { text } = await generateText({
				model: this.poe(id),
				prompt,
				temperature,
				maxOutputTokens,
				...(Object.keys(providerOptions).length > 0 && { providerOptions }),
			})
			return text
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			TelemetryService.instance.captureException(new ApiProviderError(errorMessage, "poe", id, "completePrompt"))
			throw new Error(`Poe completion error: ${errorMessage}`)
		}
	}
}
