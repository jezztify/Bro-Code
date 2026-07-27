// npx vitest run core/webview/__tests__/webviewMessageHandler.tierApiConfigs.spec.ts

import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"

describe("webviewMessageHandler - tierApiConfigs / applyTierRecommendations", () => {
	let mockProvider: {
		contextProxy: {
			getValue: ReturnType<typeof vi.fn>
			setValue: ReturnType<typeof vi.fn>
		}
		postStateToWebview: ReturnType<typeof vi.fn>
		postMessageToWebview: ReturnType<typeof vi.fn>
		providerSettingsManager: {
			listConfig: ReturnType<typeof vi.fn>
		}
		getCurrentTask: ReturnType<typeof vi.fn>
		log: ReturnType<typeof vi.fn>
	}

	let globalStateStore: Record<string, unknown>

	beforeEach(() => {
		vi.clearAllMocks()
		globalStateStore = {}

		mockProvider = {
			contextProxy: {
				getValue: vi.fn((key: string) => globalStateStore[key]),
				setValue: vi.fn((key: string, value: unknown) => {
					globalStateStore[key] = value
					return Promise.resolve()
				}),
			},
			postStateToWebview: vi.fn(),
			postMessageToWebview: vi.fn(),
			providerSettingsManager: {
				listConfig: vi.fn().mockResolvedValue([]),
			},
			getCurrentTask: vi.fn(),
			log: vi.fn(),
		}
	})

	describe("tierApiConfigs", () => {
		it("replaces the full tier -> profile map and posts state", async () => {
			await webviewMessageHandler(mockProvider as unknown as ClineProvider, {
				type: "tierApiConfigs",
				tierApiConfigs: { trivial: "id-1", hard: "id-2" },
			})

			expect(mockProvider.contextProxy.setValue).toHaveBeenCalledWith("tierApiConfigs", {
				trivial: "id-1",
				hard: "id-2",
			})
			expect(mockProvider.postStateToWebview).toHaveBeenCalled()
		})

		it("defaults to an empty map when no payload is given", async () => {
			await webviewMessageHandler(mockProvider as unknown as ClineProvider, {
				type: "tierApiConfigs",
			})

			expect(mockProvider.contextProxy.setValue).toHaveBeenCalledWith("tierApiConfigs", {})
		})
	})

	describe("applyTierRecommendations", () => {
		it("resolves recommended profile names to ids and merges into the existing map", async () => {
			globalStateStore.tierApiConfigs = { standard: "existing-id" }
			mockProvider.providerSettingsManager.listConfig.mockResolvedValue([
				{ id: "trivial-id", name: "Cheap Model" },
				{ id: "hard-id", name: "Best Model" },
			])

			await webviewMessageHandler(mockProvider as unknown as ClineProvider, {
				type: "applyTierRecommendations",
				tierRecommendations: { trivial: "Cheap Model", hard: "Best Model" },
			})

			expect(mockProvider.contextProxy.setValue).toHaveBeenCalledWith("tierApiConfigs", {
				standard: "existing-id",
				trivial: "trivial-id",
				hard: "hard-id",
			})
			expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "applyTierRecommendationsResult",
				unresolvedTiers: [],
			})
		})

		it("reports tiers whose recommended profile name did not match any configured profile", async () => {
			mockProvider.providerSettingsManager.listConfig.mockResolvedValue([
				{ id: "trivial-id", name: "Cheap Model" },
			])

			await webviewMessageHandler(mockProvider as unknown as ClineProvider, {
				type: "applyTierRecommendations",
				tierRecommendations: { trivial: "Cheap Model", hard: "Unknown Model" },
			})

			expect(mockProvider.contextProxy.setValue).toHaveBeenCalledWith(
				"tierApiConfigs",
				expect.objectContaining({ trivial: "trivial-id" }),
			)
			expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "applyTierRecommendationsResult",
				unresolvedTiers: ["hard"],
			})
		})
	})
})
