import { describe, it, expect } from "vitest"
import * as path from "path"

import { resolveStaticFile, getContentType } from "../staticAssets"

// Resolved via `path.resolve` (not `path.join`) so expectations match what
// `resolveStaticFile` itself produces internally (it calls `path.resolve` for
// traversal-safety) - on Windows, `path.join("/ext", ...)` and
// `path.resolve("/ext", ...)` disagree on drive-letter prefixing.
const extRoot = path.resolve(path.sep, "ext")

describe("resolveStaticFile", () => {
	const roots = [
		{ urlPrefix: "/mobile-assets/images/", dir: path.join(extRoot, "assets", "images") },
		{ urlPrefix: "/", dir: path.join(extRoot, "webview-ui", "build") },
	]

	it("resolves a request against the most specific matching root", () => {
		const resolved = resolveStaticFile("/mobile-assets/images/roo.png", roots)

		expect(resolved?.absolutePath).toBe(path.join(extRoot, "assets", "images", "roo.png"))
		expect(resolved?.contentType).toBe("image/png")
		expect(resolved?.isIndexHtml).toBe(false)
	})

	it("falls back to the catch-all root for unprefixed paths", () => {
		const resolved = resolveStaticFile("/assets/index.js", roots)

		expect(resolved?.absolutePath).toBe(path.join(extRoot, "webview-ui", "build", "assets", "index.js"))
		expect(resolved?.contentType).toBe("text/javascript; charset=utf-8")
	})

	it("flags index.html so the caller can apply no-cache + HTML injection", () => {
		const resolved = resolveStaticFile("/index.html", roots)

		expect(resolved?.isIndexHtml).toBe(true)
		expect(resolved?.contentType).toBe("text/html; charset=utf-8")
	})

	it("rejects path traversal escaping the matched root", () => {
		expect(resolveStaticFile("/mobile-assets/images/../../../etc/passwd", roots)).toBeUndefined()
	})

	it("rejects path traversal against the catch-all root", () => {
		expect(resolveStaticFile("/../../etc/passwd", roots)).toBeUndefined()
	})

	it("returns undefined when nothing matches (no catch-all root present)", () => {
		const noCatchAll = [{ urlPrefix: "/mobile-assets/images/", dir: "/ext/assets/images" }]
		expect(resolveStaticFile("/assets/index.js", noCatchAll)).toBeUndefined()
	})
})

describe("getContentType", () => {
	it("maps known extensions", () => {
		expect(getContentType("index.css")).toBe("text/css; charset=utf-8")
		expect(getContentType("codicon.ttf")).toBe("font/ttf")
		expect(getContentType("photo.webp")).toBe("image/webp")
	})

	it("defaults to octet-stream for unknown extensions", () => {
		expect(getContentType("mystery.xyz")).toBe("application/octet-stream")
	})
})
