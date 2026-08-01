// npx vitest run src/core/webview/__tests__/webviewMessageHandler.boardWindow.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string) => key),
	changeLanguage: vi.fn(),
}))

vi.mock("vscode", () => ({
	window: { showErrorMessage: vi.fn() },
	workspace: { workspaceFolders: undefined },
}))

vi.mock("../../../integrations/theme/getTheme", () => ({
	getTheme: vi.fn().mockResolvedValue({}),
}))

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			updateTelemetryState: vi.fn(),
			captureEvent: vi.fn(),
			captureTabShown: vi.fn(),
		},
	},
}))

const openBoardInNewWindow = vi.fn().mockResolvedValue(undefined)
const openBoardInNewTab = vi.fn().mockResolvedValue(undefined)

vi.mock("../../../activate/registerCommands", () => ({
	openBoardInNewWindow,
	openBoardInNewTab,
}))

import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"

// `webviewDidLaunch` fans out over most of the provider surface before it reaches the
// initial-tab replay, so this stubs just enough of it for the case to run to completion.
const makeProvider = (overrides: Record<string, unknown> = {}) => ({
	contextProxy: { getValue: vi.fn(), setValue: vi.fn().mockResolvedValue(undefined) },
	customModesManager: { getCustomModes: vi.fn().mockResolvedValue([]) },
	providerSettingsManager: { listConfig: vi.fn().mockResolvedValue([]) },
	postStateToWebview: vi.fn(),
	postMessageToWebview: vi.fn().mockResolvedValue(undefined),
	getStateToPostToWebview: vi.fn().mockResolvedValue({ telemetrySetting: "enabled" }),
	getMcpHub: vi.fn().mockReturnValue(undefined),
	workspaceTracker: undefined,
	isViewLaunched: false,
	context: {},
	getOutputChannel: vi.fn().mockReturnValue({ appendLine: vi.fn() }),
	log: vi.fn(),
	...overrides,
})

describe("webviewMessageHandler — board window", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("routes a launching webview to provider.initialTab", async () => {
		const provider = makeProvider({ initialTab: "board" })

		await webviewMessageHandler(provider as unknown as ClineProvider, { type: "webviewDidLaunch" })

		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "action",
			action: "switchTab",
			tab: "board",
		})
	})

	// The panel keeps its initialTab rather than consuming it, so a webview that reloads - which
	// is what moving a panel into an auxiliary window does - comes back on the board, not on chat.
	it("routes again on a second launch", async () => {
		const provider = makeProvider({ initialTab: "board" })

		await webviewMessageHandler(provider as unknown as ClineProvider, { type: "webviewDidLaunch" })
		await webviewMessageHandler(provider as unknown as ClineProvider, { type: "webviewDidLaunch" })

		const switchTabCalls = provider.postMessageToWebview.mock.calls.filter(
			(call) => (call[0] as { action?: string })?.action === "switchTab",
		)
		expect(switchTabCalls).toHaveLength(2)
	})

	it("leaves a launching webview on its default tab when no initialTab is set", async () => {
		const provider = makeProvider()

		await webviewMessageHandler(provider as unknown as ClineProvider, { type: "webviewDidLaunch" })

		expect(provider.postMessageToWebview).not.toHaveBeenCalledWith(expect.objectContaining({ action: "switchTab" }))
	})

	it("openBoardInWindow opens a detached board panel", async () => {
		const provider = makeProvider()

		await webviewMessageHandler(provider as unknown as ClineProvider, { type: "openBoardInWindow" })

		expect(openBoardInNewWindow).toHaveBeenCalledWith({
			context: provider.context,
			outputChannel: provider.getOutputChannel(),
		})
		expect(openBoardInNewTab).not.toHaveBeenCalled()
	})

	it("openBoardInWindow logs instead of rejecting when the panel fails to open", async () => {
		const provider = makeProvider()
		openBoardInNewWindow.mockRejectedValueOnce(new Error("no window for you"))

		await webviewMessageHandler(provider as unknown as ClineProvider, { type: "openBoardInWindow" })
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(provider.log).toHaveBeenCalledWith(expect.stringContaining("no window for you"))
	})
})
