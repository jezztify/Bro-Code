// npx vitest run activate/__tests__/sidebarRedirect.spec.ts

import type { Mock } from "vitest"
import * as vscode from "vscode"

import type { ClineProvider } from "../../core/webview/ClineProvider"
import { createSidebarRedirectProvider } from "../sidebarRedirect"
import { getOpenTabPanels, openClineInNewTab } from "../registerCommands"

vi.mock("vscode", () => ({
	ViewColumn: { Active: -1, One: 1, Two: 2 },
	commands: { executeCommand: vi.fn() },
}))

vi.mock("../registerCommands", () => ({
	getOpenTabPanels: vi.fn(() => []),
	openClineInNewTab: vi.fn().mockResolvedValue(undefined),
}))

const makeView = (visible: boolean) => {
	const listeners: Array<() => void> = []

	return {
		view: {
			visible,
			onDidChangeVisibility: vi.fn((listener: () => void) => {
				listeners.push(listener)
				return { dispose: vi.fn() }
			}),
		} as unknown as vscode.WebviewView & { visible: boolean },
		fireVisibilityChange: () => listeners.forEach((listener) => listener()),
	}
}

const makeOptions = () => ({
	context: { subscriptions: [] } as unknown as vscode.ExtensionContext,
	outputChannel: { appendLine: vi.fn() } as unknown as vscode.OutputChannel,
})

describe("createSidebarRedirectProvider", () => {
	let provider: ClineProvider

	beforeEach(() => {
		vi.clearAllMocks()
		;(getOpenTabPanels as Mock).mockReturnValue([])
		provider = { resolveWebviewView: vi.fn().mockResolvedValue(undefined) } as unknown as ClineProvider
	})

	it("resolves the real provider, opens a tab, and closes the sidebar", async () => {
		const { view } = makeView(true)

		await createSidebarRedirectProvider(provider, makeOptions()).resolveWebviewView(
			view,
			{} as vscode.WebviewViewResolveContext,
			{} as vscode.CancellationToken,
		)

		expect(provider.resolveWebviewView).toHaveBeenCalledWith(view)
		expect(openClineInNewTab).toHaveBeenCalledTimes(1)
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith("workbench.action.closeSidebar")
	})

	it("reveals the most recent open tab instead of opening another one", async () => {
		const older = { reveal: vi.fn(), viewColumn: 1 } as unknown as vscode.WebviewPanel
		const newest = { reveal: vi.fn(), viewColumn: 2 } as unknown as vscode.WebviewPanel
		;(getOpenTabPanels as Mock).mockReturnValue([older, newest])

		const { view } = makeView(true)
		await createSidebarRedirectProvider(provider, makeOptions()).resolveWebviewView(
			view,
			{} as vscode.WebviewViewResolveContext,
			{} as vscode.CancellationToken,
		)

		expect(openClineInNewTab).not.toHaveBeenCalled()
		expect(older.reveal).not.toHaveBeenCalled()
		expect(newest.reveal).toHaveBeenCalledWith(2, false)
	})

	it("redirects again when the view becomes visible after the initial resolve", async () => {
		// The first click resolves the view; every later click only surfaces as a visibility change.
		const { view, fireVisibilityChange } = makeView(false)

		await createSidebarRedirectProvider(provider, makeOptions()).resolveWebviewView(
			view,
			{} as vscode.WebviewViewResolveContext,
			{} as vscode.CancellationToken,
		)

		expect(openClineInNewTab).not.toHaveBeenCalled()

		view.visible = true
		fireVisibilityChange()
		await vi.waitFor(() => expect(openClineInNewTab).toHaveBeenCalledTimes(1))

		view.visible = false
		fireVisibilityChange()
		expect(openClineInNewTab).toHaveBeenCalledTimes(1)
	})

	it("logs and recovers when the handoff fails", async () => {
		;(openClineInNewTab as Mock).mockRejectedValueOnce(new Error("boom"))

		const options = makeOptions()
		const { view } = makeView(true)

		await createSidebarRedirectProvider(provider, options).resolveWebviewView(
			view,
			{} as vscode.WebviewViewResolveContext,
			{} as vscode.CancellationToken,
		)

		expect(options.outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining("boom"))

		// The re-entrancy guard must be released, so a later click still redirects.
		const second = makeView(true)
		await createSidebarRedirectProvider(provider, options).resolveWebviewView(
			second.view,
			{} as vscode.WebviewViewResolveContext,
			{} as vscode.CancellationToken,
		)

		expect(openClineInNewTab).toHaveBeenCalledTimes(2)
	})
})
