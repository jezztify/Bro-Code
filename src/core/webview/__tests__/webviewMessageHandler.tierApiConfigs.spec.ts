// npx vitest run core/webview/__tests__/webviewMessageHandler.tierApiConfigs.spec.ts

import { webviewMessageHandler } from "../webviewMessageHandler"

vi.mock("vscode", () => ({
	window: {
		showErrorMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showInformationMessage: vi.fn(),
	},
	workspace: {
		workspaceFolders: undefined,
		getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() })),
	},
	Uri: {
		parse: vi.fn((str) => ({ toString: () => str })),
		file: vi.fn((path) => ({ fsPath: path })),
	},
	env: { openExternal: vi.fn(), clipboard: { writeText: vi.fn() } },
	commands: { executeCommand: vi.fn() },
}))

vi.mock("../../task-persistence", () => ({ saveTaskMessages: vi.fn() }))
vi.mock("../../../i18n", () => ({ t: vi.fn((key: string) => key), changeLanguage: vi.fn() }))

function makeMockProvider(globalState: Record<string, any> = {}) {
	return {
		contextProxy: {
			getValue: vi.fn((key: string) => globalState[key]),
			setValue: vi.fn((key: string, value: any) => {
				globalState[key] = value
				return Promise.resolve()
			}),
		},
		providerSettingsManager: {
			listConfig: vi.fn().mockResolvedValue([
				{ id: "id-fast", name: "fast-profile" },
				{ id: "id-strong", name: "strong-profile" },
			]),
		},
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		postMessageToWebview: vi.fn().mockResolvedValue(undefined),
		getCurrentTask: vi.fn().mockReturnValue(undefined),
		cwd: "/test/workspace",
		log: vi.fn(),
	}
}

describe("webviewMessageHandler - tierApiConfigs (Feature 2/3)", () => {
	it("persists a full tierApiConfigs replacement map", async () => {
		const globalState: Record<string, any> = {}
		const provider = makeMockProvider(globalState)

		await webviewMessageHandler(
			provider as any,
			{
				type: "tierApiConfigs",
				tierApiConfigs: { trivial: "id-fast" },
			} as any,
		)

		expect(provider.contextProxy.setValue).toHaveBeenCalledWith("tierApiConfigs", { trivial: "id-fast" })
		expect(provider.postStateToWebview).toHaveBeenCalled()
	})

	it("applyTierRecommendations resolves profile names to ids and merges into existing tierApiConfigs", async () => {
		const globalState: Record<string, any> = { tierApiConfigs: { hard: "id-existing" } }
		const provider = makeMockProvider(globalState)

		await webviewMessageHandler(
			provider as any,
			{
				type: "applyTierRecommendations",
				tierRecommendations: { trivial: "fast-profile", standard: "strong-profile" },
			} as any,
		)

		expect(provider.contextProxy.setValue).toHaveBeenCalledWith("tierApiConfigs", {
			hard: "id-existing",
			trivial: "id-fast",
			standard: "id-strong",
		})
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "applyTierRecommendationsResult",
			unresolvedTiers: [],
		})
	})

	it("applyTierRecommendations reports tiers whose profile name doesn't match any configured profile", async () => {
		const globalState: Record<string, any> = {}
		const provider = makeMockProvider(globalState)

		await webviewMessageHandler(
			provider as any,
			{
				type: "applyTierRecommendations",
				tierRecommendations: { trivial: "fast-profile", hard: "no-such-profile" },
			} as any,
		)

		expect(provider.contextProxy.setValue).toHaveBeenCalledWith("tierApiConfigs", { trivial: "id-fast" })
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "applyTierRecommendationsResult",
			unresolvedTiers: ["hard"],
		})
	})
})
