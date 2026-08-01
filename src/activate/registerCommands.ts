import * as vscode from "vscode"
import delay from "delay"

import type { CommandId, WebviewMessage } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { Package } from "../shared/package"
import { getCommand } from "../utils/commands"
import { ClineProvider } from "../core/webview/ClineProvider"
import { MobileServer } from "../services/mobileServer/MobileServer"
import { ContextProxy } from "../core/config/ContextProxy"
import { focusPanel } from "../utils/focusPanel"
import { handleNewTask } from "./handleTask"
import { CodeIndexManager } from "../services/code-index/manager"
import { importSettingsWithFeedback } from "../core/config/importExport"
import { MdmService } from "../services/mdm/MdmService"
import { registerRipgrepDiagnosticCommand } from "../services/ripgrep/diagnostic"
import { t } from "../i18n"

/**
 * Helper to get the visible ClineProvider instance or log if not found.
 */
export function getVisibleProviderOrLog(outputChannel: vscode.OutputChannel): ClineProvider | undefined {
	const visibleProvider = ClineProvider.getVisibleInstance()
	if (!visibleProvider) {
		outputChannel.appendLine("Cannot find any visible Roo Code instances.")
		return undefined
	}
	return visibleProvider
}

// Store panel references in both modes
let sidebarPanel: vscode.WebviewView | undefined = undefined
let tabPanel: vscode.WebviewPanel | undefined = undefined

// Every editor-tab panel that is currently open, in the order they were opened.
// `tabPanel` above can't be used for this: `setPanel` clears it whenever the sidebar resolves,
// even though the tab is still open, so it tracks "most recently resolved panel" rather than
// "live tabs". Callers that need to reuse an already-open tab (the activity bar redirect) need
// the latter.
const openTabPanels = new Set<vscode.WebviewPanel>()

/**
 * The editor-tab panels that are currently open, oldest first.
 */
export function getOpenTabPanels(): vscode.WebviewPanel[] {
	return Array.from(openTabPanels)
}

/**
 * Get the currently active panel
 * @returns WebviewPanel或WebviewView
 */
export function getPanel(): vscode.WebviewPanel | vscode.WebviewView | undefined {
	return tabPanel || sidebarPanel
}

/**
 * Set panel references
 */
export function setPanel(
	newPanel: vscode.WebviewPanel | vscode.WebviewView | undefined,
	type: "sidebar" | "tab",
): void {
	if (type === "sidebar") {
		sidebarPanel = newPanel as vscode.WebviewView
		tabPanel = undefined
	} else {
		tabPanel = newPanel as vscode.WebviewPanel
		sidebarPanel = undefined
	}
}

export type RegisterCommandOptions = {
	context: vscode.ExtensionContext
	outputChannel: vscode.OutputChannel
	provider: ClineProvider
	mobileServer: MobileServer
}

export const registerCommands = (options: RegisterCommandOptions) => {
	const { context } = options

	for (const [id, callback] of Object.entries(getCommandsMap(options))) {
		const command = getCommand(id as CommandId)
		context.subscriptions.push(vscode.commands.registerCommand(command, callback))
	}

	context.subscriptions.push(registerRipgrepDiagnosticCommand())
}

// `showRipgrepDiagnostic` is registered separately by
// `registerRipgrepDiagnosticCommand` (above), which owns the OutputChannel
// lifecycle alongside the command registration, so it's intentionally
// excluded from this map.
//
// Callback shape mirrors VS Code's own `commands.registerCommand` signature
// (`(...args: any[]) => any`), with the return narrowed to `unknown` so
// callers must inspect before using. `any[]` for args is unavoidable: the
// callbacks here are heterogeneous (`importSettings` takes an optional
// `filePath?: string`, others take none) and VS Code dispatches positional
// args dynamically.
type CommandCallback = (...args: any[]) => unknown
const getCommandsMap = ({
	context,
	outputChannel,
	provider,
	mobileServer,
}: RegisterCommandOptions): Record<Exclude<CommandId, "showRipgrepDiagnostic">, CommandCallback> => ({
	activationCompleted: () => {},
	plusButtonClicked: async () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)

		if (!visibleProvider) {
			return
		}

		TelemetryService.instance.captureTitleButtonClicked("plus")

		// Blank the composer without touching the open task: it stays resident and keeps
		// running in the background, reachable again from the board or history.
		await visibleProvider.unfocusCurrentTask()
		await visibleProvider.refreshWorkspace()
		await visibleProvider.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
		// Send focusInput action immediately after chatButtonClicked
		// This ensures the focus happens after the view has switched
		await visibleProvider.postMessageToWebview({ type: "action", action: "focusInput" })
	},
	popoutButtonClicked: () => {
		TelemetryService.instance.captureTitleButtonClicked("popout")

		return openClineInNewTab({ context, outputChannel })
	},
	openInNewTab: () => openClineInNewTab({ context, outputChannel }),
	openBoardInNewWindow: () => {
		TelemetryService.instance.captureTitleButtonClicked("boardWindow")

		return openBoardInNewWindow({ context, outputChannel })
	},
	settingsButtonClicked: () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)

		if (!visibleProvider) {
			return
		}

		TelemetryService.instance.captureTitleButtonClicked("settings")

		void visibleProvider
			.postMessageToWebview({ type: "action", action: "settingsButtonClicked" })
			.catch((error) => outputChannel.appendLine(`[settingsButtonClicked] postMessageToWebview failed: ${error}`))
		// Also explicitly post the visibility message to trigger scroll reliably
		void visibleProvider
			.postMessageToWebview({ type: "action", action: "didBecomeVisible" })
			.catch((error) => outputChannel.appendLine(`[settingsButtonClicked] postMessageToWebview failed: ${error}`))
	},
	boardButtonClicked: () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)

		if (!visibleProvider) {
			return
		}

		TelemetryService.instance.captureTitleButtonClicked("board")

		void visibleProvider
			.postMessageToWebview({ type: "action", action: "boardButtonClicked" })
			.catch((error) => outputChannel.appendLine(`[boardButtonClicked] postMessageToWebview failed: ${error}`))
	},
	marketplaceButtonClicked: () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)
		if (!visibleProvider) return
		void visibleProvider
			.postMessageToWebview({ type: "action", action: "marketplaceButtonClicked" })
			.catch((error) =>
				outputChannel.appendLine(`[marketplaceButtonClicked] postMessageToWebview failed: ${error}`),
			)
	},
	// Retained as an alias for the board: it used to open the per-task kanban, which no longer
	// exists, so it lands on the same workspace board as boardButtonClicked.
	kanbanButtonClicked: () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)
		if (!visibleProvider) return

		TelemetryService.instance.captureTitleButtonClicked("kanban")

		void visibleProvider
			.postMessageToWebview({ type: "action", action: "boardButtonClicked" })
			.catch((error) => outputChannel.appendLine(`[kanbanButtonClicked] postMessageToWebview failed: ${error}`))
	},
	newTask: handleNewTask,
	setCustomStoragePath: async () => {
		const { promptForCustomStoragePath } = await import("../utils/storage")
		await promptForCustomStoragePath()
	},
	importSettings: async (filePath?: string) => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)
		if (!visibleProvider) {
			return
		}

		await importSettingsWithFeedback(
			{
				providerSettingsManager: visibleProvider.providerSettingsManager,
				contextProxy: visibleProvider.contextProxy,
				customModesManager: visibleProvider.customModesManager,
				provider: visibleProvider,
			},
			filePath,
		)
	},
	focusInput: async () => {
		try {
			await focusPanel(tabPanel, sidebarPanel)

			// Send focus input message only for sidebar panels
			if (sidebarPanel && getPanel() === sidebarPanel) {
				await provider.postMessageToWebview({ type: "action", action: "focusInput" })
			}
		} catch (error) {
			outputChannel.appendLine(`Error focusing input: ${error}`)
		}
	},
	focusPanel: async () => {
		try {
			await focusPanel(tabPanel, sidebarPanel)
		} catch (error) {
			outputChannel.appendLine(`Error focusing panel: ${error}`)
		}
	},
	acceptInput: () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)

		if (!visibleProvider) {
			return
		}

		void visibleProvider
			.postMessageToWebview({ type: "acceptInput" })
			.catch((error) => outputChannel.appendLine(`[acceptInput] postMessageToWebview failed: ${error}`))
	},
	toggleAutoApprove: async () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)

		if (!visibleProvider) {
			return
		}

		try {
			await visibleProvider.postMessageToWebview({
				type: "action",
				action: "toggleAutoApprove",
			})
		} catch (error) {
			outputChannel.appendLine(`[toggleAutoApprove] postMessageToWebview failed: ${error}`)
		}
	},
	startMobileServer: async () => {
		await mobileServer.start().catch((error) => {
			outputChannel.appendLine(`[startMobileServer] failed: ${error instanceof Error ? error.message : error}`)
		})
	},
	stopMobileServer: async () => {
		await mobileServer.stop().catch((error) => {
			outputChannel.appendLine(`[stopMobileServer] failed: ${error instanceof Error ? error.message : error}`)
		})
	},
	showMobileServerQrCode: () => {
		mobileServer.showQrCode()
	},
	regenerateMobileServerToken: async () => {
		await mobileServer.regenerateToken().catch((error) => {
			outputChannel.appendLine(
				`[regenerateMobileServerToken] failed: ${error instanceof Error ? error.message : error}`,
			)
		})
	},
})

export type OpenPanelOptions = Omit<RegisterCommandOptions, "provider" | "mobileServer"> & {
	/** Tab the panel lands on once its webview boots. Defaults to the usual chat view. */
	initialTab?: NonNullable<WebviewMessage["tab"]>
	/**
	 * Detach the panel into its own OS-level window (an "auxiliary window") instead of leaving it
	 * as an editor tab. Extensions can't create windows directly; the panel is created as a tab
	 * and then moved out, which is how the built-in floating editor windows work.
	 */
	newWindow?: boolean
}

export const openClineInNewTab = async ({ context, outputChannel, initialTab, newWindow }: OpenPanelOptions) => {
	// (This example uses webviewProvider activation event which is necessary to
	// deserialize cached webview, but since we use retainContextWhenHidden, we
	// don't need to use that event).
	// https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
	const contextProxy = await ContextProxy.getInstance(context)
	const codeIndexManager = CodeIndexManager.getInstance(context)

	// Get the existing MDM service instance to ensure consistent policy enforcement
	let mdmService: MdmService | undefined
	try {
		mdmService = MdmService.getInstance()
	} catch (error) {
		// MDM service not initialized, which is fine - extension can work without it
		mdmService = undefined
	}

	const tabProvider = new ClineProvider(context, outputChannel, "editor", contextProxy, mdmService)
	// Set before resolveWebviewView so the webview's first `webviewDidLaunch` already sees it;
	// the handler replays it on every launch, so a later reload (e.g. the move to a new window
	// below) lands on the same tab instead of falling back to chat.
	tabProvider.initialTab = initialTab
	const visibleEditors = vscode.window.visibleTextEditors

	// With editors open, put the panel in its own group to the right of them. With none open
	// there's still an editor group - an empty one - so splitting off a new group to the right
	// just strands that empty group beside the panel; take it over instead.
	const targetCol = visibleEditors.length
		? Math.max(Math.max(...visibleEditors.map((editor) => editor.viewColumn || 0)) + 1, 1)
		: vscode.ViewColumn.One

	const newPanel = vscode.window.createWebviewPanel(ClineProvider.tabPanelId, "Zoo Code", targetCol, {
		enableScripts: true,
		retainContextWhenHidden: true,
		localResourceRoots: [context.extensionUri],
	})

	// Save as tab type panel.
	setPanel(newPanel, "tab")
	openTabPanels.add(newPanel)

	// TODO: Use better svg icon with light and dark variants (see
	// https://stackoverflow.com/questions/58365687/vscode-extension-iconpath).
	newPanel.iconPath = {
		light: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "panel_light.png"),
		dark: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "panel_dark.png"),
	}

	await tabProvider.resolveWebviewView(newPanel)

	// Add listener for visibility changes to notify webview
	newPanel.onDidChangeViewState(
		(e) => {
			const panel = e.webviewPanel
			if (panel.visible) {
				panel.webview.postMessage({ type: "action", action: "didBecomeVisible" }) // Use the same message type as in SettingsView.tsx
			}
		},
		null, // First null is for `thisArgs`
		context.subscriptions, // Register listener for disposal
	)

	// Handle panel closing events.
	newPanel.onDidDispose(
		() => {
			openTabPanels.delete(newPanel)
			setPanel(undefined, "tab")
		},
		null,
		context.subscriptions, // Also register dispose listener
	)

	if (newWindow) {
		// `moveEditorToNewWindow` acts on the active editor group, which is the group the panel
		// was just created in, so this has to run before anything else can steal focus. A failure
		// (older VS Code, command unavailable) is non-fatal: the panel simply stays a tab.
		await delay(100)

		try {
			await vscode.commands.executeCommand("workbench.action.moveEditorToNewWindow")
		} catch (error) {
			outputChannel.appendLine(
				`[openClineInNewTab] moveEditorToNewWindow failed, leaving panel as a tab: ${error}`,
			)
		}
	}

	// Lock the editor group so clicking on files doesn't open them over the panel. After a move
	// the active group is the auxiliary window's, which is the one we want locked.
	await delay(100)
	await vscode.commands.executeCommand("workbench.action.lockEditorGroup")

	return tabProvider
}

/**
 * Open the workspace board in its own editor tab, rather than switching the tab within whichever
 * panel (sidebar or an existing editor tab) triggered it.
 *
 * The board tab is requested via `initialTab` instead of a `postMessageToWebview` after the fact:
 * the new panel's webview (React app) hasn't booted at this point and only signals readiness with
 * `webviewDidLaunch`, so an immediate post would be dropped by a webview with no listener yet.
 */
export const openBoardInNewTab = (options: Omit<OpenPanelOptions, "initialTab" | "newWindow">) =>
	openClineInNewTab({ ...options, initialTab: "board" })

/**
 * Open the workspace board in its own OS-level window, independent of the editor's tabs, so it can
 * live on a second monitor while you work. Same panel as openBoardInNewTab, just detached.
 */
export const openBoardInNewWindow = (options: Omit<OpenPanelOptions, "initialTab" | "newWindow">) =>
	openClineInNewTab({ ...options, initialTab: "board", newWindow: true })
