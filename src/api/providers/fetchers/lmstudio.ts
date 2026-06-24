import { LLM, LLMInfo, LLMInstanceInfo, LMStudioClient } from "@lmstudio/sdk"

import { type ModelInfo, lMStudioDefaultModelInfo } from "@roo-code/types"

import { flushModels, getModels } from "./modelCache"
import { lmStudioFetch, type LmStudioProxyOptions } from "../utils/lmstudio-proxy"

/**
 * axios put `.code` directly on connection errors; undici's fetch wraps the underlying socket
 * error in `.cause` instead, so callers need to check both to detect a refused connection.
 */
const isConnRefused = (error: any): boolean => error?.code === "ECONNREFUSED" || error?.cause?.code === "ECONNREFUSED"

/**
 * Unlike axios, `fetch` doesn't throw on a non-2xx response - it resolves normally with
 * `response.ok === false`. The native/v1/v0 endpoint fallback chains below rely on a throw to
 * move on to the next endpoint, so this restores that behavior.
 */
const assertOk = (response: Response): Response => {
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} ${response.statusText}`)
	}
	return response
}

const modelsWithLoadedDetails = new Set<string>()

export const hasLoadedFullDetails = (modelId: string): boolean => modelsWithLoadedDetails.has(modelId)

export const forceFullModelDetailsLoad = async (
	baseUrl: string,
	modelId: string,
	useRestApi = false,
	proxyOptions: LmStudioProxyOptions = {},
): Promise<void> => {
	if (useRestApi) {
		// REST-only mode never opens the LM Studio SDK's WebSocket connection, so there's no
		// equivalent of "loading" a model's runtime details - just refresh the REST-derived cache.
		await flushModels({ provider: "lmstudio", baseUrl, useRestApi }, true)
		modelsWithLoadedDetails.add(modelId)
		return
	}

	try {
		// Test the connection to LM Studio first
		// Errors will be caught further down.
		await lmStudioFetch(`${baseUrl}/v1/models`, proxyOptions)
		const lmsUrl = baseUrl.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://")

		const client = new LMStudioClient({ baseUrl: lmsUrl })
		await client.llm.model(modelId)
		// Flush and refresh cache to get updated model details
		await flushModels({ provider: "lmstudio", baseUrl }, true)

		// Mark this model as having full details loaded.
		modelsWithLoadedDetails.add(modelId)
	} catch (error) {
		if (isConnRefused(error)) {
			console.warn(`Error connecting to LMStudio at ${baseUrl}`)
		} else {
			console.error(
				`Error refreshing LMStudio model details: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)
		}
	}
}

export const parseLMStudioModel = (rawModel: LLMInstanceInfo | LLMInfo): ModelInfo => {
	// Handle both LLMInstanceInfo (from loaded models) and LLMInfo (from downloaded models)
	const contextLength = "contextLength" in rawModel ? rawModel.contextLength : rawModel.maxContextLength

	const modelInfo: ModelInfo = Object.assign({}, lMStudioDefaultModelInfo, {
		description: `${rawModel.displayName} - ${rawModel.path}`,
		contextWindow: contextLength,
		supportsPromptCache: true,
		supportsImages: rawModel.vision,
		maxTokens: contextLength,
	})

	return modelInfo
}

/**
 * Parses an OpenAI-compatible /v1/models REST response into ModelInfo objects.
 * Used as a fallback when the LMStudio SDK WebSocket connection fails (e.g. remote servers).
 */
export const parseOpenAIModelsResponse = (response: any): Record<string, ModelInfo> => {
	const models: Record<string, ModelInfo> = {}

	if (!response?.data || !Array.isArray(response.data)) {
		return models
	}

	for (const rawModel of response.data) {
		const modelId = rawModel.id
		if (!modelId) continue

		models[modelId] = Object.assign({}, lMStudioDefaultModelInfo, {
			description: modelId,
			contextWindow: undefined,
			supportsPromptCache: true,
			supportsImages: false,
			maxTokens: undefined,
		})
	}

	return models
}

/**
 * Parses LM Studio's native /api/v0/models REST response into ModelInfo objects.
 * Unlike the OpenAI-compatible endpoint, this includes context length and capability data,
 * so it doesn't need the SDK's WebSocket connection to produce useful model info.
 */
export const parseLMStudioNativeModelsResponse = (body: any): Record<string, ModelInfo> => {
	const models: Record<string, ModelInfo> = {}
	const rawModels = Array.isArray(body?.data) ? body.data : []

	for (const rawModel of rawModels) {
		if (rawModel?.type === "embeddings") continue

		const modelId = rawModel?.id
		if (!modelId) continue

		const contextWindow = rawModel.loaded_context_length ?? rawModel.max_context_length

		models[modelId] = Object.assign({}, lMStudioDefaultModelInfo, {
			description:
				[rawModel.publisher, rawModel.arch, rawModel.quantization].filter(Boolean).join(" - ") || modelId,
			contextWindow: contextWindow ?? lMStudioDefaultModelInfo.contextWindow,
			maxTokens: contextWindow ?? lMStudioDefaultModelInfo.maxTokens,
			supportsPromptCache: true,
			supportsImages: Array.isArray(rawModel.capabilities) && rawModel.capabilities.includes("vision"),
		})
	}

	return models
}

/**
 * Parses LM Studio's native /api/v1/models REST response into ModelInfo objects.
 * This supersedes /api/v0/models and carries context-length/capability data under a
 * different shape (top-level "models" array, "key" as the model id, structured
 * "capabilities" and "quantization" objects, and runtime context length under
 * loaded_instances[].config.context_length when the model is loaded).
 */
export const parseLMStudioV1ModelsResponse = (body: any): Record<string, ModelInfo> => {
	const models: Record<string, ModelInfo> = {}
	const rawModels = Array.isArray(body?.models) ? body.models : []

	for (const rawModel of rawModels) {
		if (rawModel?.type !== "llm") continue

		const modelId = rawModel?.key
		if (!modelId) continue

		const loadedContextLength = rawModel.loaded_instances?.[0]?.config?.context_length
		const contextWindow = loadedContextLength ?? rawModel.max_context_length

		models[modelId] = Object.assign({}, lMStudioDefaultModelInfo, {
			description:
				rawModel.description ||
				[rawModel.publisher, rawModel.architecture, rawModel.quantization?.name].filter(Boolean).join(" - ") ||
				modelId,
			contextWindow: contextWindow ?? lMStudioDefaultModelInfo.contextWindow,
			maxTokens: contextWindow ?? lMStudioDefaultModelInfo.maxTokens,
			supportsPromptCache: true,
			supportsImages: rawModel.capabilities?.vision === true,
		})
	}

	return models
}

/**
 * Fetches LM Studio models over plain HTTP only, mirroring how the lmstudio-vscode-extension
 * talks to LM Studio: no WebSocket SDK connection, just REST. Tries the native v1 API first
 * since it carries context-length/capability data, falls back to the older native v0 API,
 * and finally falls back to the OpenAI-compatible endpoint.
 */
async function getLMStudioModelsViaRestApi(
	baseUrl: string,
	proxyOptions: LmStudioProxyOptions = {},
): Promise<Record<string, ModelInfo>> {
	try {
		const v1Response = assertOk(await lmStudioFetch(`${baseUrl}/api/v1/models`, proxyOptions))
		const v1Models = parseLMStudioV1ModelsResponse(await v1Response.json())

		if (Object.keys(v1Models).length > 0) {
			return v1Models
		}
	} catch (error) {
		console.debug("LMStudio native /api/v1/models endpoint unavailable, falling back to /api/v0/models")
	}

	try {
		const nativeResponse = assertOk(await lmStudioFetch(`${baseUrl}/api/v0/models`, proxyOptions))
		const nativeModels = parseLMStudioNativeModelsResponse(await nativeResponse.json())

		if (Object.keys(nativeModels).length > 0) {
			return nativeModels
		}
	} catch (error) {
		console.debug("LMStudio native /api/v0/models endpoint unavailable, falling back to /v1/models")
	}

	try {
		const openAiModelsResponse = assertOk(await lmStudioFetch(`${baseUrl}/v1/models`, proxyOptions))
		return parseOpenAIModelsResponse(await openAiModelsResponse.json())
	} catch (error) {
		if (isConnRefused(error)) {
			console.warn(`Error connecting to LMStudio at ${baseUrl}`)
		} else {
			console.error(
				`Error fetching LMStudio models via REST API: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)
		}
		return {}
	}
}

export async function getLMStudioModels(
	baseUrl = "http://localhost:1234",
	useRestApi = false,
	proxyOptions: LmStudioProxyOptions = {},
): Promise<Record<string, ModelInfo>> {
	// clear the set of models that have full details loaded
	modelsWithLoadedDetails.clear()
	// clearing the input can leave an empty string; use the default in that case
	baseUrl = baseUrl === "" ? "http://localhost:1234" : baseUrl

	if (useRestApi) {
		if (!URL.canParse(baseUrl)) {
			return {}
		}
		return getLMStudioModelsViaRestApi(baseUrl, proxyOptions)
	}

	const models: Record<string, ModelInfo> = {}
	// ws is required to connect using the LMStudio library
	const lmsUrl = baseUrl.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://")

	try {
		if (!URL.canParse(lmsUrl)) {
			return models
		}

		// Fetch the OpenAI-compatible /v1/models response first — this works for both local and remote LM Studio.
		// We store it to use as a fallback if the WebSocket SDK calls fail below.
		const openAiModelsResponse = await (await lmStudioFetch(`${baseUrl}/v1/models`, proxyOptions)).json()

		const client = new LMStudioClient({ baseUrl: lmsUrl })

		let sdkSucceeded = false

		// First, try to get all downloaded models
		try {
			const downloadedModels = await client.system.listDownloadedModels("llm")
			for (const model of downloadedModels) {
				// Use the model path as the key since that's what users select
				models[model.path] = parseLMStudioModel(model)
			}
			sdkSucceeded = true
		} catch (error) {
			console.warn("Failed to list downloaded models, falling back to loaded models only")
		}

		// Get loaded models for their runtime info (context size)
		let loadedModels: Array<LLMInstanceInfo> = []
		try {
			loadedModels = (await client.llm.listLoaded().then((models: LLM[]) => {
				return Promise.all(models.map((m) => m.getModelInfo()))
			})) as Array<LLMInstanceInfo>

			if (loadedModels.length > 0) {
				sdkSucceeded = true
			}
		} catch (error) {
			console.warn("Failed to list loaded models, SDK connection may be unavailable")
		}

		// Deduplicate: For each loaded model, check if any downloaded model path contains the loaded model's key
		// This handles cases like loaded "llama-3.1" matching downloaded "Meta/Llama-3.1/Something"
		// If found, remove the downloaded version and add the loaded model (prefer loaded over downloaded for accurate runtime info)
		for (const lmstudioModel of loadedModels) {
			const loadedModelId = lmstudioModel.modelKey.toLowerCase()

			// Find if any downloaded model path contains the loaded model's key as a path segment
			// Use word boundaries or path separators to avoid false matches like "llama" matching "codellama"
			const existingKey = Object.keys(models).find((key) => {
				const keyLower = key.toLowerCase()
				// Check if the loaded model ID appears as a distinct segment in the path
				// This matches "llama-3.1" in "Meta/Llama-3.1/Something" but not "llama" in "codellama"
				return (
					keyLower.includes(`/${loadedModelId}/`) ||
					keyLower.includes(`/${loadedModelId}`) ||
					keyLower.startsWith(`${loadedModelId}/`) ||
					keyLower === loadedModelId
				)
			})

			if (existingKey) {
				// Remove the downloaded version
				delete models[existingKey]
			}

			// Add the loaded model (either as replacement or new entry)
			models[lmstudioModel.modelKey] = parseLMStudioModel(lmstudioModel)
			modelsWithLoadedDetails.add(lmstudioModel.modelKey)
		}

		// If the SDK calls failed entirely (common for remote LM Studio instances),
		// fall back to parsing the OpenAI-compatible REST response.
		if (!sdkSucceeded && Object.keys(models).length === 0) {
			console.debug("LMStudio SDK returned no models, falling back to OpenAI-compatible /v1/models REST API")
			const fallbackModels = parseOpenAIModelsResponse(openAiModelsResponse)
			Object.assign(models, fallbackModels)
		}
	} catch (error) {
		if (isConnRefused(error)) {
			console.warn(`Error connecting to LMStudio at ${baseUrl}`)
		} else {
			console.error(
				`Error fetching LMStudio models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)
		}
	}

	return models
}

/**
 * Parses LM Studio's native /api/v0/models REST response, keeping only embedding models
 * (the inverse of parseLMStudioNativeModelsResponse, which is built for chat/LLM models).
 */
export const parseLMStudioNativeEmbeddingModelsResponse = (body: any): string[] => {
	const rawModels = Array.isArray(body?.data) ? body.data : []
	return rawModels
		.filter((rawModel: any) => rawModel?.type === "embeddings" && rawModel?.id)
		.map((rawModel: any) => rawModel.id)
}

/**
 * Parses LM Studio's native /api/v1/models REST response, keeping only embedding models
 * (the inverse of parseLMStudioV1ModelsResponse, which is built for chat/LLM models).
 */
export const parseLMStudioV1EmbeddingModelsResponse = (body: any): string[] => {
	const rawModels = Array.isArray(body?.models) ? body.models : []
	return rawModels
		.filter((rawModel: any) => rawModel?.type === "embedding" && rawModel?.key)
		.map((rawModel: any) => rawModel.key)
}

/**
 * Fetches the list of embedding-capable model IDs from a local/remote LM Studio instance.
 * Tries the native v1 and v0 REST APIs first since they carry model-type metadata, and falls
 * back to the OpenAI-compatible /v1/models endpoint (which has no type info, so every model
 * is returned) when neither native endpoint is available.
 *
 * When `useRestApi` is true, the native LM-Studio-specific endpoints are skipped entirely and
 * only the generic OpenAI-compatible /v1/models endpoint is queried - useful when a remote or
 * proxied LM Studio instance only exposes the standard REST surface.
 */
export async function getLMStudioEmbeddingModels(
	baseUrl = "http://localhost:1234",
	useRestApi = false,
	proxyOptions: LmStudioProxyOptions = {},
): Promise<string[]> {
	baseUrl = baseUrl === "" ? "http://localhost:1234" : baseUrl

	if (!URL.canParse(baseUrl)) {
		return []
	}

	if (useRestApi) {
		try {
			const openAiModelsResponse = await lmStudioFetch(`${baseUrl}/v1/models`, proxyOptions)
			return Object.keys(parseOpenAIModelsResponse(await openAiModelsResponse.json()))
		} catch (error) {
			if (isConnRefused(error)) {
				console.warn(`Error connecting to LMStudio at ${baseUrl}`)
			} else {
				console.debug("LMStudio /v1/models endpoint unavailable")
			}
			return []
		}
	}

	try {
		const v1Response = assertOk(await lmStudioFetch(`${baseUrl}/api/v1/models`, proxyOptions))
		const v1Models = parseLMStudioV1EmbeddingModelsResponse(await v1Response.json())

		if (v1Models.length > 0) {
			return v1Models
		}
	} catch (error) {
		console.debug("LMStudio native /api/v1/models endpoint unavailable, falling back to /api/v0/models")
	}

	try {
		const nativeResponse = assertOk(await lmStudioFetch(`${baseUrl}/api/v0/models`, proxyOptions))
		const nativeModels = parseLMStudioNativeEmbeddingModelsResponse(await nativeResponse.json())

		if (nativeModels.length > 0) {
			return nativeModels
		}
	} catch (error) {
		console.debug("LMStudio native /api/v0/models endpoint unavailable, falling back to /v1/models")
	}

	try {
		const openAiModelsResponse = await lmStudioFetch(`${baseUrl}/v1/models`, proxyOptions)
		return Object.keys(parseOpenAIModelsResponse(await openAiModelsResponse.json()))
	} catch (error) {
		if (isConnRefused(error)) {
			console.warn(`Error connecting to LMStudio at ${baseUrl}`)
		} else {
			console.debug("LMStudio /v1/models endpoint unavailable")
		}
		return []
	}
}
