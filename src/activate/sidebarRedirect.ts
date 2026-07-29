import * as vscode from "vscode"

import type { ClineProvider } from "../core/webview/ClineProvider"
import { getOpenTabPanels, openClineInNewTab } from "./registerCommands"

export type SidebarRedirectOptions = {
	context: vscode.ExtensionContext
	outputChannel: vscode.OutputChannel
}

// Guards against re-entry: `closeSidebar` (and the editor-group juggling in `openClineInNewTab`)
// churn view state, which can fire another visibility change while we're still handing off.
let redirecting = false

/**
 * Reveal Zoo Code in an editor tab - reusing the tab that's already open, if any - and collapse
 * the sidebar behind it.
 */
export const redirectToEditorTab = async ({ context, outputChannel }: SidebarRedirectOptions) => {
	if (redirecting) {
		return
	}

	redirecting = true

	try {
		const panels = getOpenTabPanels()
		const existing = panels[panels.length - 1]

		if (existing) {
			existing.reveal(existing.viewColumn ?? vscode.ViewColumn.Active, false)
		} else {
			await openClineInNewTab({ context, outputChannel })
		}

		await vscode.commands.executeCommand("workbench.action.closeSidebar")
	} catch (error) {
		outputChannel.appendLine(
			`[SidebarRedirect] Failed to open Zoo Code in an editor tab: ${error instanceof Error ? error.message : String(error)}`,
		)
	} finally {
		redirecting = false
	}
}

/**
 * Clicking the activity bar icon is the one webview entry point VS Code gives no command hook
 * for - the only signal it exposes is the sidebar view becoming visible. So the sidebar view is
 * still registered (that's what puts the icon in the activity bar) and still resolves against the
 * real `provider`, which stays the instance the extension API and mobile server are bound to;
 * we just hand off to an editor tab and collapse the sidebar as soon as it shows.
 */
export const createSidebarRedirectProvider = (
	provider: ClineProvider,
	options: SidebarRedirectOptions,
): vscode.WebviewViewProvider => ({
	async resolveWebviewView(webviewView) {
		await provider.resolveWebviewView(webviewView)

		// `resolveWebviewView` only runs the first time the view is shown; every later click on
		// the activity bar icon surfaces as a visibility change on the same view.
		options.context.subscriptions.push(
			webviewView.onDidChangeVisibility(() => {
				if (webviewView.visible) {
					void redirectToEditorTab(options)
				}
			}),
		)

		if (webviewView.visible) {
			await redirectToEditorTab(options)
		}
	},
})
