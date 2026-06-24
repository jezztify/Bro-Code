import { LMStudioClient, LLMInstanceInfo, LLMInfo } from "@lmstudio/sdk"

import { ModelInfo, lMStudioDefaultModelInfo } from "@bro-code/types"

import {
	getLMStudioModels,
	parseLMStudioModel,
	parseOpenAIModelsResponse,
	parseLMStudioNativeModelsResponse,
	parseLMStudioV1ModelsResponse,
} from "../lmstudio"
import { lmStudioFetch } from "../../utils/lmstudio-proxy"

// Mock the proxy-aware fetch helper used for all LM Studio REST calls
vi.mock("../../utils/lmstudio-proxy", () => ({
	lmStudioFetch: vi.fn(),
}))
const mockedLmStudioFetch = lmStudioFetch as any

const jsonResponse = (data: any, ok = true): Response =>
	({
		ok,
		status: ok ? 200 : 500,
		statusText: ok ? "OK" : "Internal Server Error",
		json: async () => data,
	}) as unknown as Response

// Mock @lmstudio/sdk
const mockGetModelInfo = vi.fn()
const mockListLoaded = vi.fn()
const mockListDownloadedModels = vi.fn()
vi.mock("@lmstudio/sdk", () => {
	return {
		LMStudioClient: vi.fn().mockImplementation(function () {
			return {
				llm: {
					listLoaded: mockListLoaded,
				},
				system: {
					listDownloadedModels: mockListDownloadedModels,
				},
			}
		}),
	}
})
const MockedLMStudioClientConstructor = LMStudioClient as any

describe("LMStudio Fetcher", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		MockedLMStudioClientConstructor.mockClear()
		mockListLoaded.mockClear()
		mockGetModelInfo.mockClear()
		mockListDownloadedModels.mockClear()
	})

	describe("parseLMStudioModel", () => {
		it("should correctly parse raw LLMInfo to ModelInfo", () => {
			const rawModel: LLMInstanceInfo = {
				type: "llm",
				modelKey: "mistralai/devstral-small-2505",
				format: "safetensors",
				displayName: "Devstral Small 2505",
				path: "mistralai/devstral-small-2505",
				sizeBytes: 13277565112,
				architecture: "mistral",
				identifier: "mistralai/devstral-small-2505",
				instanceReference: "RAP5qbeHVjJgBiGFQ6STCuTJ",
				vision: false,
				trainedForToolUse: false,
				maxContextLength: 131072,
				contextLength: 7161,
			}

			const expectedModelInfo: ModelInfo = {
				...lMStudioDefaultModelInfo,
				description: `${rawModel.displayName} - ${rawModel.path}`,
				contextWindow: rawModel.contextLength,
				supportsPromptCache: true,
				supportsImages: rawModel.vision,
				maxTokens: rawModel.contextLength,
				inputPrice: 0,
				outputPrice: 0,
				cacheWritesPrice: 0,
				cacheReadsPrice: 0,
			}

			const result = parseLMStudioModel(rawModel)
			expect(result).toEqual(expectedModelInfo)
		})
	})

	describe("getLMStudioModels", () => {
		const baseUrl = "http://localhost:1234"
		const lmsUrl = "ws://localhost:1234"

		const mockRawModel: LLMInstanceInfo = {
			architecture: "test-arch",
			identifier: "mistralai/devstral-small-2505",
			instanceReference: "RAP5qbeHVjJgBiGFQ6STCuTJ",
			modelKey: "test-model-key-1",
			path: "/path/to/test-model-1",
			type: "llm",
			displayName: "Test Model One",
			maxContextLength: 2048,
			contextLength: 7161,
			paramsString: "1B params, 2k context",
			vision: true,
			format: "gguf",
			sizeBytes: 1000000000,
			trainedForToolUse: false, // Added
		}

		it("should fetch downloaded models using system.listDownloadedModels", async () => {
			const mockLLMInfo: LLMInfo = {
				type: "llm" as const,
				modelKey: "mistralai/devstral-small-2505",
				format: "safetensors",
				displayName: "Devstral Small 2505",
				path: "mistralai/devstral-small-2505",
				sizeBytes: 13277565112,
				architecture: "mistral",
				vision: false,
				trainedForToolUse: false,
				maxContextLength: 131072,
			}

			mockedLmStudioFetch.mockResolvedValueOnce(jsonResponse({ status: "ok" }))
			mockListDownloadedModels.mockResolvedValueOnce([mockLLMInfo])

			const result = await getLMStudioModels(baseUrl)

			expect(mockedLmStudioFetch).toHaveBeenCalledTimes(1)
			expect(mockedLmStudioFetch).toHaveBeenCalledWith(`${baseUrl}/v1/models`, {})
			expect(MockedLMStudioClientConstructor).toHaveBeenCalledTimes(1)
			expect(MockedLMStudioClientConstructor).toHaveBeenCalledWith({ baseUrl: lmsUrl })
			expect(mockListDownloadedModels).toHaveBeenCalledTimes(1)
			expect(mockListDownloadedModels).toHaveBeenCalledWith("llm")
			expect(mockListLoaded).toHaveBeenCalled() // we now call it to get context data

			const expectedParsedModel = parseLMStudioModel(mockLLMInfo)
			expect(result).toEqual({ [mockLLMInfo.path]: expectedParsedModel })
		})

		it("should fall back to listLoaded when listDownloadedModels fails", async () => {
			mockedLmStudioFetch.mockResolvedValueOnce(jsonResponse({ status: "ok" }))
			mockListDownloadedModels.mockRejectedValueOnce(new Error("Method not available"))
			mockListLoaded.mockResolvedValueOnce([{ getModelInfo: mockGetModelInfo }])
			mockGetModelInfo.mockResolvedValueOnce(mockRawModel)

			const result = await getLMStudioModels(baseUrl)

			expect(mockedLmStudioFetch).toHaveBeenCalledTimes(1)
			expect(mockedLmStudioFetch).toHaveBeenCalledWith(`${baseUrl}/v1/models`, {})
			expect(MockedLMStudioClientConstructor).toHaveBeenCalledTimes(1)
			expect(MockedLMStudioClientConstructor).toHaveBeenCalledWith({ baseUrl: lmsUrl })
			expect(mockListDownloadedModels).toHaveBeenCalledTimes(1)
			expect(mockListLoaded).toHaveBeenCalledTimes(1)

			const expectedParsedModel = parseLMStudioModel(mockRawModel)
			expect(result).toEqual({ [mockRawModel.modelKey]: expectedParsedModel })
		})

		it("should deduplicate models when both downloaded and loaded", async () => {
			const mockDownloadedModel: LLMInfo = {
				type: "llm" as const,
				modelKey: "mistralai/devstral-small-2505",
				format: "safetensors",
				displayName: "Devstral Small 2505",
				path: "mistralai/devstral-small-2505",
				sizeBytes: 13277565112,
				architecture: "mistral",
				vision: false,
				trainedForToolUse: false,
				maxContextLength: 131072,
			}

			const mockLoadedModel: LLMInstanceInfo = {
				type: "llm",
				modelKey: "devstral-small-2505", // Different key but should match case-insensitively
				format: "safetensors",
				displayName: "Devstral Small 2505",
				path: "mistralai/devstral-small-2505",
				sizeBytes: 13277565112,
				architecture: "mistral",
				identifier: "mistralai/devstral-small-2505",
				instanceReference: "RAP5qbeHVjJgBiGFQ6STCuTJ",
				vision: false,
				trainedForToolUse: false,
				maxContextLength: 131072,
				contextLength: 7161, // Runtime context info
			}

			mockedLmStudioFetch.mockResolvedValueOnce(jsonResponse({ status: "ok" }))
			mockListDownloadedModels.mockResolvedValueOnce([mockDownloadedModel])
			mockListLoaded.mockResolvedValueOnce([{ getModelInfo: vi.fn().mockResolvedValueOnce(mockLoadedModel) }])

			const result = await getLMStudioModels(baseUrl)

			// Should only have one model, with the loaded model replacing the downloaded one
			expect(Object.keys(result)).toHaveLength(1)

			// The loaded model's key should be used, with loaded model's data
			const expectedParsedModel = parseLMStudioModel(mockLoadedModel)
			expect(result[mockLoadedModel.modelKey]).toEqual(expectedParsedModel)

			// The downloaded model should have been removed
			expect(result[mockDownloadedModel.path]).toBeUndefined()
		})

		it("should handle deduplication with path-based matching", async () => {
			const mockDownloadedModel: LLMInfo = {
				type: "llm" as const,
				modelKey: "Meta/Llama-3.1/8B-Instruct",
				format: "gguf",
				displayName: "Llama 3.1 8B Instruct",
				path: "Meta/Llama-3.1/8B-Instruct",
				sizeBytes: 8000000000,
				architecture: "llama",
				vision: false,
				trainedForToolUse: false,
				maxContextLength: 8192,
			}

			const mockLoadedModel: LLMInstanceInfo = {
				type: "llm",
				modelKey: "Llama-3.1", // Should match the path segment
				format: "gguf",
				displayName: "Llama 3.1",
				path: "Meta/Llama-3.1/8B-Instruct",
				sizeBytes: 8000000000,
				architecture: "llama",
				identifier: "Meta/Llama-3.1/8B-Instruct",
				instanceReference: "ABC123",
				vision: false,
				trainedForToolUse: false,
				maxContextLength: 8192,
				contextLength: 4096,
			}

			mockedLmStudioFetch.mockResolvedValueOnce(jsonResponse({ status: "ok" }))
			mockListDownloadedModels.mockResolvedValueOnce([mockDownloadedModel])
			mockListLoaded.mockResolvedValueOnce([{ getModelInfo: vi.fn().mockResolvedValueOnce(mockLoadedModel) }])

			const result = await getLMStudioModels(baseUrl)

			expect(Object.keys(result)).toHaveLength(1)
			expect(result[mockLoadedModel.modelKey]).toBeDefined()
			expect(result[mockDownloadedModel.path]).toBeUndefined()
		})

		it("should not deduplicate models with similar but distinct names", async () => {
			const mockDownloadedModels: LLMInfo[] = [
				{
					type: "llm" as const,
					modelKey: "mistral-7b",
					format: "gguf",
					displayName: "Mistral 7B",
					path: "mistralai/mistral-7b-instruct",
					sizeBytes: 7000000000,
					architecture: "mistral",
					vision: false,
					trainedForToolUse: false,
					maxContextLength: 4096,
				},
				{
					type: "llm" as const,
					modelKey: "codellama",
					format: "gguf",
					displayName: "Code Llama",
					path: "meta/codellama/7b",
					sizeBytes: 7000000000,
					architecture: "llama",
					vision: false,
					trainedForToolUse: false,
					maxContextLength: 4096,
				},
			]

			const mockLoadedModel: LLMInstanceInfo = {
				type: "llm",
				modelKey: "llama", // Should not match "codellama" or "mistral-7b"
				format: "gguf",
				displayName: "Llama",
				path: "meta/llama/7b",
				sizeBytes: 7000000000,
				architecture: "llama",
				identifier: "meta/llama/7b",
				instanceReference: "XYZ789",
				vision: false,
				trainedForToolUse: false,
				maxContextLength: 4096,
				contextLength: 2048,
			}

			mockedLmStudioFetch.mockResolvedValueOnce(jsonResponse({ status: "ok" }))
			mockListDownloadedModels.mockResolvedValueOnce(mockDownloadedModels)
			mockListLoaded.mockResolvedValueOnce([{ getModelInfo: vi.fn().mockResolvedValueOnce(mockLoadedModel) }])

			const result = await getLMStudioModels(baseUrl)

			// Should have 3 models: mistral-7b (not deduped), codellama (not deduped), and llama (loaded)
			expect(Object.keys(result)).toHaveLength(3)
			expect(result["mistralai/mistral-7b-instruct"]).toBeDefined() // Should NOT be removed
			expect(result["meta/codellama/7b"]).toBeDefined() // Should NOT be removed (codellama != llama)
			expect(result[mockLoadedModel.modelKey]).toBeDefined()
		})

		it("should handle multiple loaded models with various duplicate scenarios", async () => {
			const mockDownloadedModels: LLMInfo[] = [
				{
					type: "llm" as const,
					modelKey: "mistral-7b",
					format: "gguf",
					displayName: "Mistral 7B",
					path: "mistralai/mistral-7b/instruct",
					sizeBytes: 7000000000,
					architecture: "mistral",
					vision: false,
					trainedForToolUse: false,
					maxContextLength: 8192,
				},
				{
					type: "llm" as const,
					modelKey: "llama-3.1",
					format: "gguf",
					displayName: "Llama 3.1",
					path: "meta/llama-3.1/8b",
					sizeBytes: 8000000000,
					architecture: "llama",
					vision: false,
					trainedForToolUse: false,
					maxContextLength: 8192,
				},
			]

			const mockLoadedModels: LLMInstanceInfo[] = [
				{
					type: "llm",
					modelKey: "mistral-7b", // Exact match with path segment
					format: "gguf",
					displayName: "Mistral 7B",
					path: "mistralai/mistral-7b/instruct",
					sizeBytes: 7000000000,
					architecture: "mistral",
					identifier: "mistralai/mistral-7b/instruct",
					instanceReference: "REF1",
					vision: false,
					trainedForToolUse: false,
					maxContextLength: 8192,
					contextLength: 4096,
				},
				{
					type: "llm",
					modelKey: "gpt-4", // No match, new model
					format: "gguf",
					displayName: "GPT-4",
					path: "openai/gpt-4",
					sizeBytes: 10000000000,
					architecture: "gpt",
					identifier: "openai/gpt-4",
					instanceReference: "REF2",
					vision: true,
					trainedForToolUse: true,
					maxContextLength: 32768,
					contextLength: 16384,
				},
			]

			mockedLmStudioFetch.mockResolvedValueOnce(jsonResponse({ status: "ok" }))
			mockListDownloadedModels.mockResolvedValueOnce(mockDownloadedModels)
			mockListLoaded.mockResolvedValueOnce(
				mockLoadedModels.map((model) => ({ getModelInfo: vi.fn().mockResolvedValueOnce(model) })),
			)

			const result = await getLMStudioModels(baseUrl)

			// Should have 3 models: llama-3.1 (downloaded), mistral-7b (loaded, replaced), gpt-4 (loaded, new)
			expect(Object.keys(result)).toHaveLength(3)
			expect(result["meta/llama-3.1/8b"]).toBeDefined() // Downloaded, not replaced
			expect(result["mistralai/mistral-7b/instruct"]).toBeUndefined() // Downloaded, replaced
			expect(result["mistral-7b"]).toBeDefined() // Loaded, replaced downloaded
			expect(result["gpt-4"]).toBeDefined() // Loaded, new
		})

		it("should use default baseUrl if an empty string is provided", async () => {
			const defaultBaseUrl = "http://localhost:1234"
			const defaultLmsUrl = "ws://localhost:1234"
			mockedLmStudioFetch.mockResolvedValueOnce(jsonResponse({}))
			mockListLoaded.mockResolvedValueOnce([])

			await getLMStudioModels("")

			expect(mockedLmStudioFetch).toHaveBeenCalledWith(`${defaultBaseUrl}/v1/models`, {})
			expect(MockedLMStudioClientConstructor).toHaveBeenCalledWith({ baseUrl: defaultLmsUrl })
		})

		it("should transform https baseUrl to wss for LMStudioClient", async () => {
			const httpsBaseUrl = "https://securehost:4321"
			const wssLmsUrl = "wss://securehost:4321"
			mockedLmStudioFetch.mockResolvedValueOnce(jsonResponse({}))
			mockListLoaded.mockResolvedValueOnce([])

			await getLMStudioModels(httpsBaseUrl)

			expect(mockedLmStudioFetch).toHaveBeenCalledWith(`${httpsBaseUrl}/v1/models`, {})
			expect(MockedLMStudioClientConstructor).toHaveBeenCalledWith({ baseUrl: wssLmsUrl })
		})

		it("should return an empty object if lmsUrl is unparsable", async () => {
			const unparsableBaseUrl = "http://localhost:invalid:port" // Leads to ws://localhost:invalid:port

			const result = await getLMStudioModels(unparsableBaseUrl)

			expect(result).toEqual({})
			expect(mockedLmStudioFetch).not.toHaveBeenCalled()
			expect(MockedLMStudioClientConstructor).not.toHaveBeenCalled()
		})

		it("should return an empty object and log error if the REST connectivity check fails with a generic error", async () => {
			const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(function () {})
			const networkError = new Error("Network connection failed")
			mockedLmStudioFetch.mockRejectedValueOnce(networkError)

			const result = await getLMStudioModels(baseUrl)

			expect(mockedLmStudioFetch).toHaveBeenCalledTimes(1)
			expect(mockedLmStudioFetch).toHaveBeenCalledWith(`${baseUrl}/v1/models`, {})
			expect(MockedLMStudioClientConstructor).not.toHaveBeenCalled()
			expect(mockListLoaded).not.toHaveBeenCalled()
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				`Error fetching LMStudio models: ${JSON.stringify(networkError, Object.getOwnPropertyNames(networkError), 2)}`,
			)
			expect(result).toEqual({})
			consoleErrorSpy.mockRestore()
		})

		it("should return an empty object and log info if the REST connectivity check fails with ECONNREFUSED", async () => {
			const consoleInfoSpy = vi.spyOn(console, "warn").mockImplementation(function () {})
			const econnrefusedError = new Error("Connection refused")
			;(econnrefusedError as any).code = "ECONNREFUSED"
			mockedLmStudioFetch.mockRejectedValueOnce(econnrefusedError)

			const result = await getLMStudioModels(baseUrl)

			expect(mockedLmStudioFetch).toHaveBeenCalledTimes(1)
			expect(mockedLmStudioFetch).toHaveBeenCalledWith(`${baseUrl}/v1/models`, {})
			expect(MockedLMStudioClientConstructor).not.toHaveBeenCalled()
			expect(mockListLoaded).not.toHaveBeenCalled()
			expect(consoleInfoSpy).toHaveBeenCalledWith(`Error connecting to LMStudio at ${baseUrl}`)
			expect(result).toEqual({})
			consoleInfoSpy.mockRestore()
		})

		it("should return an empty object and log error if listDownloadedModels fails", async () => {
			const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(function () {})

			const listError = new Error("Failed to list downloaded models")

			mockedLmStudioFetch.mockResolvedValueOnce(jsonResponse({}))
			mockListDownloadedModels.mockRejectedValueOnce(listError)
			mockListLoaded.mockRejectedValueOnce(listError)

			const result = await getLMStudioModels(baseUrl)

			expect(mockedLmStudioFetch).toHaveBeenCalledTimes(1)
			expect(MockedLMStudioClientConstructor).toHaveBeenCalledTimes(1)
			expect(MockedLMStudioClientConstructor).toHaveBeenCalledWith({ baseUrl: lmsUrl })
			expect(mockListLoaded).toHaveBeenCalledTimes(1)
			expect(consoleWarnSpy).toHaveBeenCalledWith(
				"Failed to list downloaded models, falling back to loaded models only",
			)
			expect(result).toEqual({})
			consoleWarnSpy.mockRestore()
		})

		it("should fall back to OpenAI-compatible REST API when SDK calls fail", async () => {
			const consoleDebugSpy = vi.spyOn(console, "debug").mockImplementation(function () {})
			const sdkError = new Error("WebSocket connection failed")

			const openAiModelsResponse = {
				data: [{ id: "llama-3.1-8b" }, { id: "mistral-7b-instruct" }],
			}

			mockedLmStudioFetch.mockResolvedValueOnce(jsonResponse(openAiModelsResponse))
			mockListDownloadedModels.mockRejectedValueOnce(sdkError)
			mockListLoaded.mockRejectedValueOnce(sdkError)

			const result = await getLMStudioModels(baseUrl)

			expect(mockedLmStudioFetch).toHaveBeenCalledTimes(1)
			expect(MockedLMStudioClientConstructor).toHaveBeenCalledTimes(1)
			expect(mockListDownloadedModels).toHaveBeenCalledTimes(1)
			expect(mockListLoaded).toHaveBeenCalledTimes(1)
			expect(consoleDebugSpy).toHaveBeenCalledWith(
				"LMStudio SDK returned no models, falling back to OpenAI-compatible /v1/models REST API",
			)
			expect(Object.keys(result)).toHaveLength(2)
			expect(result["llama-3.1-8b"]).toBeDefined()
			expect(result["mistral-7b-instruct"]).toBeDefined()
			expect(result["llama-3.1-8b"].description).toBe("llama-3.1-8b")
			consoleDebugSpy.mockRestore()
		})

		it("should not fall back to REST API when SDK returns some models", async () => {
			const consoleDebugSpy = vi.spyOn(console, "debug").mockImplementation(function () {})

			const openAiModelsResponse = {
				data: [{ id: "rest-model" }],
			}

			const mockLoadedModel: LLMInstanceInfo = {
				type: "llm",
				modelKey: "sdk-model",
				displayName: "SDK Model",
				path: "/path/to/sdk-model",
				maxContextLength: 4096,
				contextLength: 4096,
				paramsString: "1B params",
				vision: false,
				format: "gguf",
				sizeBytes: 1000000000,
				architecture: "llama",
				identifier: "sdk-model",
				instanceReference: "ABC123",
				trainedForToolUse: false,
			}

			const mockLlmInstance = {
				getModelInfo: () => Promise.resolve(mockLoadedModel),
			}

			mockedLmStudioFetch.mockResolvedValueOnce(jsonResponse(openAiModelsResponse))
			mockListDownloadedModels.mockRejectedValueOnce(new Error("SDK error"))
			mockListLoaded.mockResolvedValueOnce([mockLlmInstance])

			const result = await getLMStudioModels(baseUrl)

			expect(Object.keys(result)).toHaveLength(1)
			expect(result["sdk-model"]).toBeDefined()
			expect(result["rest-model"]).toBeUndefined() // Should NOT include REST models when SDK succeeded
			expect(consoleDebugSpy).not.toHaveBeenCalled()
			consoleDebugSpy.mockRestore()
		})
	})

	describe("parseLMStudioNativeModelsResponse", () => {
		it("should parse native /api/v0/models entries into ModelInfo", () => {
			const body = {
				data: [
					{
						id: "qwen2.5-7b-instruct",
						object: "model",
						type: "llm",
						publisher: "qwen",
						arch: "qwen2",
						quantization: "Q4_K_M",
						state: "loaded",
						max_context_length: 32768,
						loaded_context_length: 8192,
						capabilities: ["tool_use", "vision"],
					},
					{
						id: "text-embedding-nomic-embed-text-v1.5",
						object: "model",
						type: "embeddings",
						max_context_length: 2048,
					},
				],
			}

			const result = parseLMStudioNativeModelsResponse(body)

			expect(Object.keys(result)).toEqual(["qwen2.5-7b-instruct"])
			expect(result["qwen2.5-7b-instruct"].contextWindow).toBe(8192)
			expect(result["qwen2.5-7b-instruct"].maxTokens).toBe(8192)
			expect(result["qwen2.5-7b-instruct"].supportsImages).toBe(true)
		})

		it("should return an empty object for malformed input", () => {
			expect(parseLMStudioNativeModelsResponse(undefined)).toEqual({})
			expect(parseLMStudioNativeModelsResponse({})).toEqual({})
		})

		it("should include vlm models", () => {
			const body = {
				data: [
					{
						id: "google/gemma-4-12b-qat",
						object: "model",
						type: "vlm",
						publisher: "google",
						arch: "gemma4",
						quantization: "Q4_0",
						max_context_length: 262144,
						capabilities: ["tool_use"],
					},
				],
			}

			const result = parseLMStudioNativeModelsResponse(body)

			expect(Object.keys(result)).toEqual(["google/gemma-4-12b-qat"])
		})
	})

	describe("parseLMStudioV1ModelsResponse", () => {
		it("should parse native /api/v1/models entries into ModelInfo", () => {
			const body = {
				models: [
					{
						type: "embedding",
						publisher: "mixedbread-ai",
						key: "text-embedding-mxbai-embed-large-v1",
						display_name: "Mxbai Embed Large v1",
						max_context_length: 512,
						format: "gguf",
					},
					{
						type: "llm",
						publisher: "unsloth",
						key: "qwen3.6-35b-a3b-mtp",
						display_name: "Qwen3.6 35B A3B UD",
						architecture: "qwen35moe",
						quantization: { name: "Q4_K_S", bits_per_weight: 4 },
						size_bytes: 23174624160,
						params_string: "35B-A3B",
						loaded_instances: [
							{
								id: "qwen3.6-35b-a3b-mtp",
								config: { context_length: 65535 },
								remaining_ttl_seconds: 7200,
							},
						],
						max_context_length: 262144,
						format: "gguf",
						capabilities: { vision: true, trained_for_tool_use: true },
					},
					{
						type: "llm",
						publisher: "mradermacher",
						key: "deepseek-r1-finance-reasoning-14b",
						display_name: "DeepSeek R1 Finance Reasoning 14B",
						architecture: "qwen2",
						quantization: { name: "Q4_K_M", bits_per_weight: 4 },
						size_bytes: 8988110976,
						params_string: "14B",
						loaded_instances: [],
						max_context_length: 131072,
						format: "gguf",
						capabilities: { vision: false, trained_for_tool_use: true },
					},
				],
			}

			const result = parseLMStudioV1ModelsResponse(body)

			expect(Object.keys(result)).toEqual(["qwen3.6-35b-a3b-mtp", "deepseek-r1-finance-reasoning-14b"])
			// Loaded model uses the runtime context length from loaded_instances.
			expect(result["qwen3.6-35b-a3b-mtp"].contextWindow).toBe(65535)
			expect(result["qwen3.6-35b-a3b-mtp"].supportsImages).toBe(true)
			// Unloaded model falls back to max_context_length.
			expect(result["deepseek-r1-finance-reasoning-14b"].contextWindow).toBe(131072)
			expect(result["deepseek-r1-finance-reasoning-14b"].supportsImages).toBe(false)
		})

		it("should return an empty object for malformed input", () => {
			expect(parseLMStudioV1ModelsResponse(undefined)).toEqual({})
			expect(parseLMStudioV1ModelsResponse({})).toEqual({})
		})
	})

	describe("getLMStudioModels with useRestApi", () => {
		const baseUrl = "http://localhost:1234"

		it("should use the native v1 REST endpoint and never open the SDK WebSocket", async () => {
			mockedLmStudioFetch.mockResolvedValueOnce(
				jsonResponse({
					models: [
						{
							type: "llm",
							key: "qwen2.5-7b-instruct",
							max_context_length: 32768,
						},
					],
				}),
			)

			const result = await getLMStudioModels(baseUrl, true)

			expect(mockedLmStudioFetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/models`, {})
			expect(MockedLMStudioClientConstructor).not.toHaveBeenCalled()
			expect(result["qwen2.5-7b-instruct"]).toBeDefined()
		})

		it("should fall back to /api/v0/models when the v1 endpoint fails", async () => {
			mockedLmStudioFetch.mockRejectedValueOnce(new Error("v1 endpoint unavailable"))
			mockedLmStudioFetch.mockResolvedValueOnce(
				jsonResponse({
					data: [
						{
							id: "qwen2.5-7b-instruct",
							type: "llm",
							max_context_length: 32768,
						},
					],
				}),
			)

			const result = await getLMStudioModels(baseUrl, true)

			expect(mockedLmStudioFetch).toHaveBeenNthCalledWith(1, `${baseUrl}/api/v1/models`, {})
			expect(mockedLmStudioFetch).toHaveBeenNthCalledWith(2, `${baseUrl}/api/v0/models`, {})
			expect(MockedLMStudioClientConstructor).not.toHaveBeenCalled()
			expect(result["qwen2.5-7b-instruct"]).toBeDefined()
		})

		it("should fall back to /v1/models when both native REST endpoints fail", async () => {
			mockedLmStudioFetch.mockRejectedValueOnce(new Error("v1 endpoint unavailable"))
			mockedLmStudioFetch.mockRejectedValueOnce(new Error("v0 endpoint unavailable"))
			mockedLmStudioFetch.mockResolvedValueOnce(jsonResponse({ data: [{ id: "llama-3.1-8b" }] }))

			const result = await getLMStudioModels(baseUrl, true)

			expect(mockedLmStudioFetch).toHaveBeenNthCalledWith(1, `${baseUrl}/api/v1/models`, {})
			expect(mockedLmStudioFetch).toHaveBeenNthCalledWith(2, `${baseUrl}/api/v0/models`, {})
			expect(mockedLmStudioFetch).toHaveBeenNthCalledWith(3, `${baseUrl}/v1/models`, {})
			expect(MockedLMStudioClientConstructor).not.toHaveBeenCalled()
			expect(result["llama-3.1-8b"]).toBeDefined()
		})

		it("should return an empty object when all REST endpoints fail", async () => {
			mockedLmStudioFetch.mockRejectedValueOnce(new Error("v1 endpoint unavailable"))
			mockedLmStudioFetch.mockRejectedValueOnce(new Error("v0 endpoint unavailable"))
			mockedLmStudioFetch.mockRejectedValueOnce(new Error("v1 (openai) endpoint unavailable"))

			const result = await getLMStudioModels(baseUrl, true)

			expect(result).toEqual({})
		})
	})
})
