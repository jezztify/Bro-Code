/**
 * Globals injected into the built webview-ui `index.html` so the same React app
 * that runs inside VS Code's webview can boot as a plain mobile-browser SPA
 * (see `webview-ui/src/utils/vscode.ts`'s third `VSCodeAPIWrapper` mode and
 * `webview-ui/src/App.tsx`'s mobile-mode branch).
 */
export interface MobileBootstrapGlobals {
	/** `ws://<lan-ip>:<port>/ws?token=...` - detected by `vscode.ts` to switch transport. */
	wsUrl: string
	/** `/mobile-assets/images` - backs `window.IMAGES_BASE_URI`. */
	imagesBaseUri: string
	/** `/mobile-assets/audio` - backs `window.AUDIO_BASE_URI`. */
	audioBaseUri: string
	/** `/mobile-assets/material-icons` - backs `window.MATERIAL_ICONS_BASE_URI`. */
	materialIconsBaseUri: string
}

/**
 * Injects the mobile bootstrap `<script>` block right after the opening `<head>`
 * tag (mirroring the existing inline-script pattern in `ClineProvider.ts`'s
 * `getHtmlContent`/`getHMRHtmlContent`), plus a `<link>` to the mobile
 * theme-fallback stylesheet - inserted first in `<head>` specifically so it
 * precedes the app's own bundled `<link rel="stylesheet">` in source order,
 * letting the app's real CSS win the cascade once it loads while the fallback
 * `--vscode-*` values still resolve on first paint before that happens. Throws
 * if `html` has no `<head>` tag - that would mean the Vite build output changed
 * shape and this needs to be revisited.
 */
export function injectMobileBootstrap(html: string, globals: MobileBootstrapGlobals): string {
	const headOpenMatch = html.match(/<head[^>]*>/i)

	if (!headOpenMatch || headOpenMatch.index === undefined) {
		throw new Error("injectMobileBootstrap: no <head> tag found in webview-ui build output")
	}

	const insertionIndex = headOpenMatch.index + headOpenMatch[0].length

	const script = `
		<link rel="stylesheet" href="/mobile-theme-dark.css">
		<script>
			window.ZOO_MOBILE_MODE = true;
			window.ZOO_MOBILE_WS_URL = ${JSON.stringify(globals.wsUrl)};
			window.IMAGES_BASE_URI = ${JSON.stringify(globals.imagesBaseUri)};
			window.AUDIO_BASE_URI = ${JSON.stringify(globals.audioBaseUri)};
			window.MATERIAL_ICONS_BASE_URI = ${JSON.stringify(globals.materialIconsBaseUri)};
		</script>
	`

	return `${html.slice(0, insertionIndex)}${script}${html.slice(insertionIndex)}`
}
