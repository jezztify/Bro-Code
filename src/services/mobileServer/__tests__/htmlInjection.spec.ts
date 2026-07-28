import { describe, it, expect } from "vitest"

import { injectMobileBootstrap } from "../htmlInjection"

const sampleHtml = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<script type="module" crossorigin src="/assets/index.js"></script>
		<link rel="stylesheet" crossorigin href="/assets/index.css">
	</head>
	<body>
		<div id="root"></div>
	</body>
</html>
`

describe("injectMobileBootstrap", () => {
	it("injects the bootstrap globals and theme stylesheet before </head>", () => {
		const result = injectMobileBootstrap(sampleHtml, {
			wsUrl: "ws://192.168.1.10:8790/ws?token=abc123",
			imagesBaseUri: "/mobile-assets/images",
			audioBaseUri: "/mobile-assets/audio",
			materialIconsBaseUri: "/mobile-assets/material-icons",
		})

		expect(result).toContain("window.ZOO_MOBILE_MODE = true;")
		expect(result).toContain('window.ZOO_MOBILE_WS_URL = "ws://192.168.1.10:8790/ws?token=abc123";')
		expect(result).toContain('window.IMAGES_BASE_URI = "/mobile-assets/images";')
		expect(result).toContain('window.AUDIO_BASE_URI = "/mobile-assets/audio";')
		expect(result).toContain('window.MATERIAL_ICONS_BASE_URI = "/mobile-assets/material-icons";')
		expect(result).toContain('<link rel="stylesheet" href="/mobile-theme-dark.css">')

		// The injected block must land before </head> (and thus before the app's own CSS link stays intact after it).
		const headCloseIndex = result.indexOf("</head>")
		const scriptIndex = result.indexOf("window.ZOO_MOBILE_MODE")
		expect(scriptIndex).toBeGreaterThan(-1)
		expect(scriptIndex).toBeLessThan(headCloseIndex)
	})

	it("places the mobile theme stylesheet before the app's own bundled CSS link", () => {
		const result = injectMobileBootstrap(sampleHtml, {
			wsUrl: "ws://x/ws",
			imagesBaseUri: "/a",
			audioBaseUri: "/b",
			materialIconsBaseUri: "/c",
		})

		const themeLinkIndex = result.indexOf("/mobile-theme-dark.css")
		const appCssIndex = result.indexOf("/assets/index.css")

		expect(themeLinkIndex).toBeGreaterThan(-1)
		expect(themeLinkIndex).toBeLessThan(appCssIndex)
	})

	it("leaves the rest of the document untouched", () => {
		const result = injectMobileBootstrap(sampleHtml, {
			wsUrl: "ws://x/ws",
			imagesBaseUri: "/a",
			audioBaseUri: "/b",
			materialIconsBaseUri: "/c",
		})

		expect(result).toContain('<div id="root"></div>')
		expect(result).toContain('src="/assets/index.js"')
	})

	it("throws if the input has no </head> tag", () => {
		expect(() =>
			injectMobileBootstrap("<html><body>no head here</body></html>", {
				wsUrl: "ws://x/ws",
				imagesBaseUri: "/a",
				audioBaseUri: "/b",
				materialIconsBaseUri: "/c",
			}),
		).toThrow()
	})
})
