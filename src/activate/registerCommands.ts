import * as vscode from "vscode"
import delay from "delay"

import type { CommandId } from "@bro-code/types"
import { TelemetryService } from "@bro-code/telemetry"

import { Package } from "../shared/package"
import { getCommand } from "../utils/commands"
import { ClineProvider } from "../core/webview/ClineProvider"
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
		outputChannel.appendLine("Cannot find any visible Bro Code instances.")
		return undefined
	}
	return visibleProvider
}

// Store panel references in both modes. Unlike the sidebar (one view at a
// time), multiple editor-tab panels can be open simultaneously - each backed
// by its own ClineProvider instance - so tabs are tracked as a provider/panel
// map rather than a single reference.
let sidebarPanel: vscode.WebviewView | undefined = undefined
const tabProviders = new Map<ClineProvider, vscode.WebviewPanel>()

/**
 * The tab panel the user is currently interacting with, falling back to the
 * most recently opened tab if no tab reports itself as the visible instance.
 */
function getActiveTabPanel(): vscode.WebviewPanel | undefined {
	const visibleProvider = ClineProvider.getVisibleInstance()
	const activePanel = visibleProvider && tabProviders.get(visibleProvider)

	if (activePanel) {
		return activePanel
	}

	const panels = Array.from(tabProviders.values())
	return panels[panels.length - 1]
}

/**
 * Get the currently active panel
 * @returns WebviewPanel或WebviewView
 */
export function getPanel(): vscode.WebviewPanel | vscode.WebviewView | undefined {
	return getActiveTabPanel() || sidebarPanel
}

/**
 * Set panel references. Tab panels are paired with their owning provider in
 * `tabProviders` by `openClineInNewTab`, so the "tab" case here only handles
 * clearing all tracked tabs (used by tests to reset module state between
 * runs); `resolveWebviewView`'s own setPanel("tab", ...) call for a panel
 * already tracked there is otherwise a no-op.
 */
export function setPanel(
	newPanel: vscode.WebviewPanel | vscode.WebviewView | undefined,
	type: "sidebar" | "tab",
): void {
	if (type === "sidebar") {
		sidebarPanel = newPanel as vscode.WebviewView
	} else if (!newPanel) {
		tabProviders.clear()
	}
}

export type RegisterCommandOptions = {
	context: vscode.ExtensionContext
	outputChannel: vscode.OutputChannel
	provider: ClineProvider
}

export const registerCommands = (options: RegisterCommandOptions) => {
	const { context, outputChannel } = options

	for (const [id, callback] of Object.entries(getCommandsMap(options))) {
		const command = getCommand(id as CommandId)
		context.subscriptions.push(vscode.commands.registerCommand(command, callback))
	}

	context.subscriptions.push(registerTabPanelSerializer({ context, outputChannel }))
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
}: RegisterCommandOptions): Record<Exclude<CommandId, "showRipgrepDiagnostic">, CommandCallback> => ({
	activationCompleted: () => {},
	plusButtonClicked: async () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)

		if (!visibleProvider) {
			return
		}

		TelemetryService.instance.captureTitleButtonClicked("plus")

		// In the sidebar, "New Task" resets the current task in place. In an
		// editor tab, that would discard the tab's conversation, so open a
		// fresh tab alongside it instead.
		if (visibleProvider.isEditorTab) {
			await openClineInNewTab({ context, outputChannel }, { forceNew: true })
			return
		}

		await visibleProvider.removeClineFromStack()
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
	historyButtonClicked: () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)

		if (!visibleProvider) {
			return
		}

		TelemetryService.instance.captureTitleButtonClicked("history")

		void visibleProvider
			.postMessageToWebview({ type: "action", action: "historyButtonClicked" })
			.catch((error) => outputChannel.appendLine(`[historyButtonClicked] postMessageToWebview failed: ${error}`))
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
			await focusPanel(getActiveTabPanel(), sidebarPanel)

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
			await focusPanel(getActiveTabPanel(), sidebarPanel)
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
})

/**
 * Wire up a `ClineProvider` against an already-created tab `WebviewPanel` -
 * shared by `openClineInNewTab` (panel created fresh) and the
 * `WebviewPanelSerializer` (panel restored by VS Code after a window reload).
 */
async function attachTabPanel(
	panel: vscode.WebviewPanel,
	{ context, outputChannel }: Omit<RegisterCommandOptions, "provider">,
) {
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

	// Save as tab type panel.
	tabProviders.set(tabProvider, panel)

	// TODO: Use better svg icon with light and dark variants (see
	// https://stackoverflow.com/questions/58365687/vscode-extension-iconpath).
	panel.iconPath = {
		light: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "panel_light.png"),
		dark: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "panel_dark.png"),
	}

	await tabProvider.resolveWebviewView(panel)

	// Add listener for visibility changes to notify webview
	panel.onDidChangeViewState(
		(e) => {
			const viewPanel = e.webviewPanel
			if (viewPanel.visible) {
				viewPanel.webview.postMessage({ type: "action", action: "didBecomeVisible" }) // Use the same message type as in SettingsView.tsx
			}
		},
		null, // First null is for `thisArgs`
		context.subscriptions, // Register listener for disposal
	)

	// Handle panel closing events.
	panel.onDidDispose(
		() => {
			tabProviders.delete(tabProvider)
		},
		null,
		context.subscriptions, // Also register dispose listener
	)

	// Lock the editor group so clicking on files doesn't open them over the panel.
	await delay(100)
	await vscode.commands.executeCommand("workbench.action.lockEditorGroup")

	return tabProvider
}

export const openClineInNewTab = async (
	options: Omit<RegisterCommandOptions, "provider">,
	{ forceNew = false }: { forceNew?: boolean } = {},
) => {
	const { context } = options

	// If a Bro Code tab is already open, just reveal it instead of spawning a
	// duplicate panel (which also left a stray empty editor group behind).
	// `forceNew` skips this so "New Task" from within an editor tab can open
	// an additional tab alongside the one already open.
	if (!forceNew) {
		const lastEntry = Array.from(tabProviders.entries()).pop()

		if (lastEntry) {
			const [existingProvider, existingPanel] = lastEntry
			existingPanel.reveal(existingPanel.viewColumn)
			return existingProvider
		}
	}

	const lastCol = Math.max(...vscode.window.visibleTextEditors.map((editor) => editor.viewColumn || 0))

	// Check if there are any visible editor groups (text editors or other
	// webview panel tabs), otherwise open a new group to the right.
	const hasVisibleEditors = vscode.window.tabGroups.all.length > 0

	if (!hasVisibleEditors) {
		await vscode.commands.executeCommand("workbench.action.newGroupRight")
	}

	const targetCol = hasVisibleEditors ? Math.max(lastCol + 1, 1) : vscode.ViewColumn.Two

	const newPanel = vscode.window.createWebviewPanel(ClineProvider.tabPanelId, "Bro Code", targetCol, {
		enableScripts: true,
		retainContextWhenHidden: true,
		localResourceRoots: [context.extensionUri],
	})

	return attachTabPanel(newPanel, options)
}

/**
 * Restore Bro Code editor tabs across a window reload. VS Code persists tab
 * placement for any panel whose view type was registered with a serializer
 * at the time the window closed, then replays it here with a fresh
 * `WebviewPanel` shell that still needs its webview options and `ClineProvider`
 * wired up - same as a newly opened tab, just without the reveal/placement step.
 */
export function registerTabPanelSerializer(options: Omit<RegisterCommandOptions, "provider">) {
	const { context, outputChannel } = options

	return vscode.window.registerWebviewPanelSerializer(ClineProvider.tabPanelId, {
		async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: { taskId?: string } | undefined) {
			// `attachTabPanel` throwing here (e.g. a dependency not ready yet
			// this early in activation) would otherwise leave VS Code's restored
			// panel shell permanently blank with no visible error anywhere, since
			// nothing surfaces a rejected deserializeWebviewPanel promise to the
			// user. Catch broadly and log so a failure is at least diagnosable.
			try {
				outputChannel.appendLine(
					`[registerTabPanelSerializer] Restoring tab panel (state: ${JSON.stringify(state)})`,
				)

				panel.webview.options = {
					enableScripts: true,
					localResourceRoots: [context.extensionUri],
				}

				const tabProvider = await attachTabPanel(panel, options)
				outputChannel.appendLine(`[registerTabPanelSerializer] Tab panel restored`)

				// Restored panels can come back reporting `visible: false` even
				// though they're the front-most tab in their group - a known VS
				// Code quirk where the webview never gets nudged to actually
				// mount its content, leaving it permanently blank/gray. An
				// explicit reveal forces VS Code to (re-)activate it.
				panel.reveal(panel.viewColumn)

				// `state` is whatever the webview last passed to `vscode.setState()`
				// (see ExtensionStateContext's "state" message handler), so the tab
				// reopens with the same task instead of a blank chat.
				//
				// Deliberately not awaited: `showTaskWithId`'s trailing
				// `postMessageToWebview` call can hang indefinitely against a
				// freshly restored panel whose webview content hasn't finished
				// mounting yet (its postMessage promise never settles until the
				// page is ready). The existing `resumeTask`/`webviewDidLaunch`
				// call sites already treat `showTaskWithId` as fire-and-forget
				// for the same reason - awaiting it here would otherwise block
				// the whole panel-restore flow forever.
				if (state?.taskId) {
					const taskId = state.taskId
					tabProvider
						.showTaskWithId(taskId)
						.then(() => outputChannel.appendLine(`[registerTabPanelSerializer] Restored task ${taskId}`))
						.catch((error) =>
							outputChannel.appendLine(
								`[registerTabPanelSerializer] Failed to restore task ${taskId}: ${error}`,
							),
						)
				}
			} catch (error) {
				outputChannel.appendLine(
					`[registerTabPanelSerializer] Failed to restore tab panel: ${error instanceof Error ? (error.stack ?? error.message) : error}`,
				)
			}
		},
	})
}
