import type { MockedFunction } from "vitest"

import { CodeIndexLmStudioEmbedder } from "../lmstudio"

global.fetch = vitest.fn() as MockedFunction<typeof fetch>

vitest.mock("@bro-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vitest.fn(),
		},
	},
}))

vitest.mock("../../../../i18n", () => ({
	t: (key: string, params?: Record<string, any>) => {
		let result = key
		if (params) {
			Object.entries(params).forEach(([param, value]) => {
				result = result.replace(new RegExp(`{{${param}}}`, "g"), String(value))
			})
		}
		return result
	},
}))

const consoleMocks = {
	error: vitest.spyOn(console, "error").mockImplementation(function () {}),
}

describe("CodeIndexLmStudioEmbedder", () => {
	let embedder: CodeIndexLmStudioEmbedder
	let mockFetch: MockedFunction<typeof fetch>

	beforeEach(() => {
		vitest.clearAllMocks()
		consoleMocks.error.mockClear()

		mockFetch = global.fetch as MockedFunction<typeof fetch>

		embedder = new CodeIndexLmStudioEmbedder({
			lmStudioModelId: "text-embedding-nomic-embed-text-v1.5",
			lmStudioBaseUrl: "http://localhost:1234",
		})
	})

	afterEach(() => {
		vitest.clearAllMocks()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(embedder.embedderInfo.name).toBe("lmstudio")
		})

		it("should use default base URL when not provided", async () => {
			const embedderWithDefaults = new CodeIndexLmStudioEmbedder({})
			expect(embedderWithDefaults.embedderInfo.name).toBe("lmstudio")

			mockFetch.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ data: [{ embedding: [0.1, 0.2] }] }),
			} as Response)

			await embedderWithDefaults.createEmbeddings(["test"])

			expect(mockFetch).toHaveBeenCalledWith(
				"http://localhost:1234/v1/embeddings",
				expect.objectContaining({ method: "POST" }),
			)
		})

		it("should normalize URLs with trailing slashes", async () => {
			const embedderWithTrailingSlash = new CodeIndexLmStudioEmbedder({
				lmStudioBaseUrl: "http://localhost:1234/",
				lmStudioModelId: "text-embedding-nomic-embed-text-v1.5",
			})

			mockFetch.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ data: [{ embedding: [0.1, 0.2] }] }),
			} as Response)

			await embedderWithTrailingSlash.createEmbeddings(["test"])

			expect(mockFetch).toHaveBeenCalledWith(
				"http://localhost:1234/v1/embeddings",
				expect.objectContaining({ method: "POST" }),
			)
		})
	})

	describe("createEmbeddings", () => {
		it("should create embeddings successfully", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () =>
					Promise.resolve({
						data: [{ embedding: [0.1, 0.2, 0.3] }],
						usage: { prompt_tokens: 5, total_tokens: 5 },
					}),
			} as Response)

			const result = await embedder.createEmbeddings(["hello world"])

			expect(result.embeddings).toEqual([[0.1, 0.2, 0.3]])
			expect(result.usage).toEqual({ promptTokens: 5, totalTokens: 5 })

			const call = mockFetch.mock.calls[0]
			expect(call[0]).toBe("http://localhost:1234/v1/embeddings")
			expect(JSON.parse(call[1]?.body as string)).toEqual({
				model: "text-embedding-nomic-embed-text-v1.5",
				input: ["hello world"],
			})
		})

		it("should throw a connection error when LM Studio is not running", async () => {
			const connError = new Error("fetch failed") as Error & { code?: string }
			connError.code = "ECONNREFUSED"
			mockFetch.mockRejectedValueOnce(connError)

			await expect(embedder.createEmbeddings(["test"])).rejects.toThrow("embeddings:lmstudio.serviceNotRunning")
		})

		it("should throw when the response is not ok", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 404,
				statusText: "Not Found",
				text: () => Promise.resolve("model not found"),
			} as Response)

			await expect(embedder.createEmbeddings(["test"])).rejects.toThrow()
		})
	})

	describe("validateConfiguration", () => {
		it("should validate successfully when the embeddings endpoint responds", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ data: [{ embedding: [0.1, 0.2] }] }),
			} as Response)

			const result = await embedder.validateConfiguration()

			expect(result.valid).toBe(true)
			expect(result.error).toBeUndefined()
		})

		it("should fail validation when the service is unreachable", async () => {
			const connError = new Error("fetch failed") as Error & { code?: string }
			connError.code = "ECONNREFUSED"
			mockFetch.mockRejectedValueOnce(connError)

			const result = await embedder.validateConfiguration()

			expect(result.valid).toBe(false)
			expect(result.error).toBe("embeddings:lmstudio.serviceNotRunning")
		})

		it("should fail validation when the endpoint returns 404", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 404,
				statusText: "Not Found",
			} as Response)

			const result = await embedder.validateConfiguration()

			expect(result.valid).toBe(false)
			expect(result.error).toBe("embeddings:lmstudio.serviceNotRunning")
		})
	})
})
