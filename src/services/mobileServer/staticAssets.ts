import * as path from "path"
import * as fsp from "fs/promises"

/**
 * A single static root: requests whose pathname starts with `urlPrefix` are
 * resolved against `dir` on disk (with the prefix stripped first).
 */
export interface StaticRoot {
	urlPrefix: string
	dir: string
}

export interface ResolvedStaticFile {
	absolutePath: string
	contentType: string
	/** `true` for the SPA's own `index.html` - sent with a no-cache header (Phase C). */
	isIndexHtml: boolean
}

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".wav": "audio/wav",
	".mp3": "audio/mpeg",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".wasm": "application/wasm",
}

export function getContentType(filePath: string): string {
	return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream"
}

/**
 * Resolves a request pathname (e.g. `/assets/index.js`, `/mobile-assets/images/roo.png`)
 * to an absolute file path under one of `roots`, guarding against `..` path traversal
 * escaping the matched root. Returns `undefined` if no root matches or the resolved
 * path escapes its root.
 */
export function resolveStaticFile(pathname: string, roots: StaticRoot[]): ResolvedStaticFile | undefined {
	// Longest-prefix-first so a more specific root (e.g. "/mobile-assets/images/")
	// wins over a catch-all root (e.g. "/").
	const sortedRoots = [...roots].sort((a, b) => b.urlPrefix.length - a.urlPrefix.length)

	for (const root of sortedRoots) {
		if (!pathname.startsWith(root.urlPrefix)) {
			continue
		}

		const relative = pathname.slice(root.urlPrefix.length)
		const normalizedRoot = path.resolve(root.dir)
		const absolutePath = path.resolve(normalizedRoot, `.${path.sep}${relative}`)

		// Reject anything that resolves outside the matched root directory.
		if (absolutePath !== normalizedRoot && !absolutePath.startsWith(normalizedRoot + path.sep)) {
			continue
		}

		return {
			absolutePath,
			contentType: getContentType(absolutePath),
			isIndexHtml: path.basename(absolutePath) === "index.html",
		}
	}

	return undefined
}

/**
 * Reads a resolved static file from disk. Returns `undefined` if the file
 * doesn't exist or isn't a regular file (e.g. a directory), so the caller can
 * respond 404 without a stack trace for the very common "no such file" case.
 */
export async function readStaticFile(resolved: ResolvedStaticFile): Promise<Buffer | undefined> {
	try {
		const stat = await fsp.stat(resolved.absolutePath)

		if (!stat.isFile()) {
			return undefined
		}

		return await fsp.readFile(resolved.absolutePath)
	} catch {
		return undefined
	}
}
