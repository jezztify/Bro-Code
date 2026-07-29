// npx vitest run activate/__tests__/openClineInNewTab.spec.ts

import type { Mock } from "vitest"
import * as vscode from "vscode"

import { ClineProvider } from "../../core/webview/ClineProvider"
import { getOpenTabPanels, openClineInNewTab } from "../registerCommands"

vi.mock("delay", () => ({ default: vi.fn().mockResolvedValue(undefined) }))

vi.mock("vscode", () => ({
	ViewColumn: { One: 1, Two: 2, Three: 3 },
	Uri: { joinPath: vi.fn(() => ({})) },
	window: {
		visibleTextEditors: [] as Array<{ viewColumn?: number }>,
		createWebviewPanel: vi.fn(),
		createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
	},
	workspace: { workspaceFolders: [], getConfiguration: vi.fn(() => ({ get: vi.fn() })) },
	commands: { executeCommand: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock("../../core/webview/ClineProvider")

vi.mock("../../core/config/ContextProxy", () => ({
	ContextProxy: { getInstance: vi.fn().mockResolvedValue({}) },
}))

vi.mock("../../services/code-index/manager", () => ({
	CodeIndexManager: { getInstance: vi.fn() },
}))

vi.mock("../../services/mdm/MdmService", () => ({
	MdmService: { getInstance: vi.fn() },
}))

vi.mock("../../shared/package", () => ({ Package: { name: "zoo-code" } }))

const makePanel = () => ({
	iconPath: undefined,
	viewColumn: 1,
	webview: { postMessage: vi.fn() },
	onDidChangeViewState: vi.fn(),
	onDidDispose: vi.fn(),
	reveal: vi.fn(),
})

const options = {
	context: { extensionUri: {}, subscriptions: [] } as unknown as vscode.ExtensionContext,
	outputChannel: { appendLine: vi.fn() } as unknown as vscode.OutputChannel,
}

const setVisibleEditors = (viewColumns: number[]) => {
	;(vscode.window as unknown as { visibleTextEditors: Array<{ viewColumn?: number }> }).visibleTextEditors =
		viewColumns.map((viewColumn) => ({ viewColumn }))
}

describe("openClineInNewTab", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		;(vscode.window.createWebviewPanel as Mock).mockImplementation(() => makePanel())
		;(ClineProvider as unknown as Mock).mockImplementation(function (this: Record<string, unknown>) {
			this.resolveWebviewView = vi.fn().mockResolvedValue(undefined)
		})
		setVisibleEditors([])
	})

	it("takes over the existing empty group rather than stranding it when no editors are open", async () => {
		await openClineInNewTab(options)

		expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith("workbench.action.newGroupRight")
		expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
			ClineProvider.tabPanelId,
			expect.any(String),
			vscode.ViewColumn.One,
			expect.any(Object),
		)
	})

	it("opens to the right of the last visible editor", async () => {
		setVisibleEditors([1, 2])

		await openClineInNewTab(options)

		expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
			ClineProvider.tabPanelId,
			expect.any(String),
			3,
			expect.any(Object),
		)
	})

	it("tracks the panel as open until it is disposed", async () => {
		const panel = makePanel()
		;(vscode.window.createWebviewPanel as Mock).mockReturnValue(panel)

		await openClineInNewTab(options)
		expect(getOpenTabPanels()).toContain(panel)

		// Second argument of `onDidDispose(listener, thisArgs, disposables)`.
		const disposeListener = (panel.onDidDispose as Mock).mock.calls[0][0]
		disposeListener()
		expect(getOpenTabPanels()).not.toContain(panel)
	})
})
