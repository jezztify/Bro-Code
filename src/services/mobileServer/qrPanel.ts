import * as vscode from "vscode"

import { t } from "../../i18n"
import { getNonce } from "../../core/webview/getNonce"

import { renderQrSvg } from "./qrCode"

const VIEW_TYPE = "zooCodeMobileServerQr"

/**
 * Single reused panel: the status bar item is clicked repeatedly, and stacking
 * a new editor tab per click would be obnoxious. Module-level rather than a
 * class field because `MobileServer` is itself a singleton and the panel
 * outlives nothing else.
 */
let panel: vscode.WebviewPanel | undefined

/**
 * The URL currently rendered in the panel. Held separately from the closure
 * that created the panel so token rotation (`updateMobileServerQrPanel`) can
 * repoint "Copy Link" at the new URL instead of copying a dead one.
 */
let currentUrl: string | undefined

/** Opens (or re-reveals and refreshes) the pairing panel showing `url` as a QR code. */
export function showMobileServerQrPanel(url: string): void {
	currentUrl = url

	if (panel) {
		panel.webview.html = buildHtml(url)
		panel.reveal(panel.viewColumn, /* preserveFocus */ false)
		return
	}

	panel = vscode.window.createWebviewPanel(VIEW_TYPE, t("common:mobileServer.qr.title"), vscode.ViewColumn.Active, {
		enableScripts: true,
		// No `localResourceRoots`: the QR is inline SVG and the page loads no
		// external assets at all, so the webview needs access to nothing on disk.
		localResourceRoots: [],
	})

	panel.onDidDispose(() => {
		panel = undefined
		currentUrl = undefined
	})

	panel.webview.onDidReceiveMessage(async (message: { type?: string } | undefined) => {
		if (message?.type === "copyLink" && currentUrl) {
			await vscode.env.clipboard.writeText(currentUrl)
			void panel?.webview.postMessage({ type: "copied" })
		}
	})

	panel.webview.html = buildHtml(url)
}

/**
 * Re-renders the panel for a new URL if it happens to be open, otherwise does
 * nothing. Used after the pairing token is rotated, so an already-displayed QR
 * can't keep advertising a token that no longer works.
 */
export function updateMobileServerQrPanel(url: string): void {
	if (!panel) {
		return
	}

	// Deliberately no `reveal()` here: a rotation is a background event, and
	// yanking focus to an editor tab the user didn't just ask for is rude.
	currentUrl = url
	panel.webview.html = buildHtml(url)
}

/** Closes the panel, if open - the link it shows is dead once the server stops. */
export function disposeMobileServerQrPanel(): void {
	panel?.dispose()
	panel = undefined
	currentUrl = undefined
}

function buildHtml(url: string): string {
	const nonce = getNonce()
	const svg = renderQrSvg(url)

	return /* html */ `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<meta
			http-equiv="Content-Security-Policy"
			content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
		<title>${escapeHtml(t("common:mobileServer.qr.title"))}</title>
		<style nonce="${nonce}">
			body {
				display: flex;
				flex-direction: column;
				align-items: center;
				gap: 16px;
				padding: 32px 20px;
				font-family: var(--vscode-font-family);
				font-size: var(--vscode-font-size);
				color: var(--vscode-foreground);
			}
			.hint {
				margin: 0;
				max-width: 340px;
				text-align: center;
				color: var(--vscode-descriptionForeground);
			}
			.qr {
				/* Padded white plate: keeps the quiet zone light-on-light under a
				   dark theme, which is what makes the symbol scannable. */
				background: #ffffff;
				border-radius: 8px;
				padding: 12px;
				width: min(320px, 70vw);
			}
			.qr svg {
				display: block;
				width: 100%;
				height: auto;
			}
			.url {
				max-width: 340px;
				padding: 8px 10px;
				border: 1px solid var(--vscode-panel-border, transparent);
				border-radius: 4px;
				background: var(--vscode-textCodeBlock-background);
				font-family: var(--vscode-editor-font-family);
				font-size: 12px;
				overflow-wrap: anywhere;
				text-align: center;
			}
			button {
				padding: 6px 16px;
				border: none;
				border-radius: 2px;
				background: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				font-family: inherit;
				font-size: inherit;
				cursor: pointer;
			}
			button:hover {
				background: var(--vscode-button-hoverBackground);
			}
			button:focus-visible {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: 2px;
			}
		</style>
	</head>
	<body>
		<p class="hint">${escapeHtml(t("common:mobileServer.qr.hint"))}</p>
		<div class="qr">${svg}</div>
		<div class="url">${escapeHtml(url)}</div>
		<button id="copy" type="button">${escapeHtml(t("common:mobileServer.notification.copyLink"))}</button>
		<script nonce="${nonce}">
			const vscode = acquireVsCodeApi()
			const button = document.getElementById("copy")
			const copyLabel = ${JSON.stringify(t("common:mobileServer.notification.copyLink"))}
			const copiedLabel = ${JSON.stringify(t("common:mobileServer.qr.copied"))}
			let resetTimer

			button.addEventListener("click", () => vscode.postMessage({ type: "copyLink" }))

			window.addEventListener("message", (event) => {
				if (event.data?.type !== "copied") {
					return
				}

				button.textContent = copiedLabel
				clearTimeout(resetTimer)
				resetTimer = setTimeout(() => {
					button.textContent = copyLabel
				}, 2000)
			})
		</script>
	</body>
</html>`
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;")
}
