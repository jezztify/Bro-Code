import * as http from "http"
import * as path from "path"
import * as fsp from "fs/promises"

import { WebSocket } from "ws"

/** Matches `getHMRHtmlContent`'s default in `ClineProvider.ts`. */
const DEFAULT_VITE_PORT = "5173"

/**
 * Reads the port the Vite dev server wrote to `.vite-port` at the repo root
 * (see `persistPortPlugin` in `webview-ui/vite.config.ts`). Mirrors what
 * `ClineProvider.getHMRHtmlContent` already does, resolved from `extensionPath`
 * rather than `__dirname` for the same reason `getMobileThemeCssPath` is:
 * esbuild bundles this module into `dist/`.
 */
export async function readVitePort(extensionPath: string): Promise<string> {
	try {
		return (await fsp.readFile(path.join(extensionPath, "..", ".vite-port"), "utf8")).trim() || DEFAULT_VITE_PORT
	} catch {
		return DEFAULT_VITE_PORT
	}
}

export interface ViteProxyResponse {
	status: number
	headers: http.IncomingHttpHeaders
	body: Buffer
}

/**
 * Forwards a request to the Vite dev server running on localhost. Returns
 * `undefined` when Vite isn't reachable, so the caller can fall back to the
 * static build instead of surfacing a connection error to the phone.
 *
 * `localhost` resolves from the extension host, which is the whole point: the
 * phone cannot reach the dev server itself (Vite binds loopback and pins
 * `server.hmr.host` to `localhost`), so the mobile server fetches on its behalf.
 */
export function proxyToVite(
	port: string,
	requestPath: string,
	timeoutMs = 10_000,
): Promise<ViteProxyResponse | undefined> {
	return new Promise((resolve) => {
		const request = http.get(
			{ host: "127.0.0.1", port, path: requestPath, headers: { host: `localhost:${port}` } },
			(response) => {
				const chunks: Buffer[] = []
				response.on("data", (chunk: Buffer) => chunks.push(chunk))
				response.on("end", () =>
					resolve({
						status: response.statusCode ?? 200,
						headers: response.headers,
						body: Buffer.concat(chunks),
					}),
				)
				response.on("error", () => resolve(undefined))
			},
		)

		request.on("error", () => resolve(undefined))
		request.setTimeout(timeoutMs, () => {
			request.destroy()
			resolve(undefined)
		})
	})
}

/**
 * Watches Vite's HMR WebSocket from the extension host and invokes `onReload`
 * whenever the dev server reports a change.
 *
 * We deliberately do *not* translate the HMR protocol through to the phone.
 * `server.hmr.host` is pinned to `localhost` in `webview-ui/vite.config.ts`, so
 * the phone's HMR client could never dial it, and repointing that at the LAN
 * address risks the desktop webview's own HMR. Instead the phone gets a plain
 * "reload the page" nudge over the mobile WebSocket it already holds - blunter
 * than true HMR, but it always serves current code and reuses existing transport.
 */
export class ViteHmrWatcher {
	private ws?: WebSocket
	private reconnectTimer?: ReturnType<typeof setTimeout>
	private stopped = false

	constructor(
		private readonly port: string,
		private readonly onReload: () => void,
		private readonly log: (message: string) => void,
	) {}

	start(): void {
		this.stopped = false
		this.connect()
	}

	private connect(): void {
		if (this.stopped) {
			return
		}

		try {
			// Vite's HMR endpoint negotiates the `vite-hmr` subprotocol.
			const ws = new WebSocket(`ws://127.0.0.1:${this.port}`, "vite-hmr")
			this.ws = ws

			ws.on("message", (data) => {
				try {
					const payload = JSON.parse(data.toString("utf8")) as { type?: string }

					// `update` covers HMR-accepted edits, `full-reload` covers the rest.
					// Either way the phone just reloads, so both map to the same nudge.
					if (payload.type === "update" || payload.type === "full-reload") {
						this.onReload()
					}
				} catch {
					// Non-JSON frames (pings) are not interesting.
				}
			})

			ws.on("close", () => this.scheduleReconnect())
			ws.on("error", () => {
				// Vite may simply not be running; reconnect quietly rather than logging noise.
				ws.close()
			})
		} catch (error) {
			this.log(
				`[MobileServer] Vite HMR watcher failed to connect: ${error instanceof Error ? error.message : error}`,
			)
			this.scheduleReconnect()
		}
	}

	private scheduleReconnect(): void {
		if (this.stopped || this.reconnectTimer) {
			return
		}

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined
			this.connect()
		}, 2_000)
	}

	stop(): void {
		this.stopped = true

		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = undefined
		}

		try {
			this.ws?.close()
		} catch {
			// Already closing/closed.
		}

		this.ws = undefined
	}
}
