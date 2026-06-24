import { fetch as undiciFetch } from "undici"

import { ApiHandlerOptions } from "../../../shared/api"
import { EmbedderInfo, EmbeddingResponse, IEmbedder } from "../interfaces"
import { getDefaultModelId, getModelQueryPrefix } from "../../../shared/embeddingModels"
import { MAX_ITEM_TOKENS } from "../constants"
import { t } from "../../../i18n"
import { withValidationErrorHandling, sanitizeErrorMessage } from "../shared/validation-helpers"
import { TelemetryService } from "@bro-code/telemetry"
import { TelemetryEventName } from "@bro-code/types"

const LMSTUDIO_EMBEDDING_TIMEOUT_MS = 60000
const LMSTUDIO_VALIDATION_TIMEOUT_MS = 30000

interface LMStudioEmbeddingItem {
	embedding: number[]
}

interface LMStudioEmbeddingResponse {
	data: LMStudioEmbeddingItem[]
	usage?: {
		prompt_tokens?: number
		total_tokens?: number
	}
}

/**
 * Implements the IEmbedder interface using a local LM Studio instance's
 * OpenAI-compatible /v1/embeddings endpoint. LM Studio requires no API key.
 */
export class CodeIndexLmStudioEmbedder implements IEmbedder {
	private readonly baseUrl: string
	private readonly defaultModelId: string
	// VS Code patches `globalThis.fetch` in the extension host to honor the user's configured
	// `http.proxy`/system proxy. For a local/LAN LM Studio server that proxy is often the wrong
	// route (and may reject it outright), so when the user opts in we bypass it by calling
	// undici's fetch directly instead of the patched global one (mirrors LmStudioHandler).
	private readonly fetchImpl: typeof fetch

	constructor(options: ApiHandlerOptions) {
		let baseUrl = options.lmStudioBaseUrl || "http://localhost:1234"
		baseUrl = baseUrl.replace(/\/+$/, "")

		this.baseUrl = baseUrl
		this.defaultModelId = options.lmStudioModelId || getDefaultModelId("lmstudio")
		this.fetchImpl = options.lmStudioBypassProxy ? (undiciFetch as unknown as typeof fetch) : fetch
	}

	async createEmbeddings(texts: string[], model?: string): Promise<EmbeddingResponse> {
		const modelToUse = model || this.defaultModelId
		const url = `${this.baseUrl}/v1/embeddings`

		const queryPrefix = getModelQueryPrefix("lmstudio", modelToUse)
		const processedTexts = queryPrefix
			? texts.map((text, index) => {
					if (text.startsWith(queryPrefix)) {
						return text
					}
					const prefixedText = `${queryPrefix}${text}`
					const estimatedTokens = Math.ceil(prefixedText.length / 4)
					if (estimatedTokens > MAX_ITEM_TOKENS) {
						console.warn(
							t("embeddings:textWithPrefixExceedsTokenLimit", {
								index,
								estimatedTokens,
								maxTokens: MAX_ITEM_TOKENS,
							}),
						)
						return text
					}
					return prefixedText
				})
			: texts

		try {
			const controller = new AbortController()
			const timeoutId = setTimeout(() => controller.abort(), LMSTUDIO_EMBEDDING_TIMEOUT_MS)

			const response = await this.fetchImpl(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: modelToUse,
					input: processedTexts,
				}),
				signal: controller.signal,
			})
			clearTimeout(timeoutId)

			if (!response.ok) {
				let errorBody = ""
				try {
					errorBody = await response.text()
				} catch (e) {
					// Ignore error reading body
				}
				const error = new Error(`HTTP ${response.status}: ${response.statusText} ${errorBody}`) as Error & {
					status?: number
				}
				error.status = response.status
				throw error
			}

			const data = (await response.json()) as LMStudioEmbeddingResponse
			if (!data?.data || !Array.isArray(data.data)) {
				throw new Error(t("embeddings:validation.invalidResponse"))
			}

			return {
				embeddings: data.data.map((item) => item.embedding),
				usage: {
					promptTokens: data.usage?.prompt_tokens || 0,
					totalTokens: data.usage?.total_tokens || 0,
				},
			}
		} catch (error: any) {
			TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
				error: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
				stack: error instanceof Error ? sanitizeErrorMessage(error.stack || "") : undefined,
				location: "LmStudioEmbedder:createEmbeddings",
			})

			console.error("LM Studio embedding failed:", error)

			if (error.name === "AbortError") {
				throw new Error(t("embeddings:validation.connectionFailed"))
			} else if (error.message?.includes("fetch failed") || error.code === "ECONNREFUSED") {
				throw new Error(t("embeddings:lmstudio.serviceNotRunning", { baseUrl: this.baseUrl }))
			} else if (error.code === "ENOTFOUND") {
				throw new Error(t("embeddings:lmstudio.hostNotFound", { baseUrl: this.baseUrl }))
			}

			throw new Error(t("embeddings:lmstudio.embeddingFailed", { message: error.message }))
		}
	}

	/**
	 * Validates the LM Studio embedder configuration by checking service availability
	 * and ensuring the configured model can produce embeddings.
	 */
	async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
		return withValidationErrorHandling(
			async () => {
				const controller = new AbortController()
				const timeoutId = setTimeout(() => controller.abort(), LMSTUDIO_VALIDATION_TIMEOUT_MS)

				const testResponse = await this.fetchImpl(`${this.baseUrl}/v1/embeddings`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model: this.defaultModelId,
						input: ["test"],
					}),
					signal: controller.signal,
				})
				clearTimeout(timeoutId)

				if (!testResponse.ok) {
					if (testResponse.status === 404) {
						return {
							valid: false,
							error: t("embeddings:lmstudio.serviceNotRunning", { baseUrl: this.baseUrl }),
						}
					}
					return {
						valid: false,
						error: t("embeddings:lmstudio.modelNotEmbeddingCapable", { modelId: this.defaultModelId }),
					}
				}

				return { valid: true }
			},
			"lmstudio",
			{
				beforeStandardHandling: (error: any) => {
					if (
						error?.message?.includes("fetch failed") ||
						error?.code === "ECONNREFUSED" ||
						error?.message?.includes("ECONNREFUSED")
					) {
						TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
							error: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
							stack: error instanceof Error ? sanitizeErrorMessage(error.stack || "") : undefined,
							location: "LmStudioEmbedder:validateConfiguration:connectionFailed",
						})
						return {
							valid: false,
							error: t("embeddings:lmstudio.serviceNotRunning", { baseUrl: this.baseUrl }),
						}
					} else if (error?.code === "ENOTFOUND" || error?.message?.includes("ENOTFOUND")) {
						return {
							valid: false,
							error: t("embeddings:lmstudio.hostNotFound", { baseUrl: this.baseUrl }),
						}
					} else if (error?.name === "AbortError") {
						return {
							valid: false,
							error: t("embeddings:validation.connectionFailed"),
						}
					}
					return undefined
				},
			},
		)
	}

	get embedderInfo(): EmbedderInfo {
		return {
			name: "lmstudio",
		}
	}
}
