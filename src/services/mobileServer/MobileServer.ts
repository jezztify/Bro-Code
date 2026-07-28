import * as http from "http"
import type { Duplex } from "stream"
import * as path from "path"
import * as fsp from "fs/promises"

import * as vscode from "vscode"
import { WebSocketServer, WebSocket } from "ws"

import type { WebviewMessage, ExtensionMessage } from "@roo-code/types"

import { t } from "../../i18n"
import { Package } from "../../shared/package"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { webviewMessageHandler } from "../../core/webview/webviewMessageHandler"

import { getLanAddress, listLanAddressCandidates } from "./lanAddress"
import {
	generatePairingToken,
	generateCookieSecret,
	createSessionCookie,
	verifySessionCookie,
	verifyPairingToken,
	parseCookies,
	buildSessionCookieHeader,
	SESSION_COOKIE_NAME,
} from "./auth"
import { resolveStaticFile, readStaticFile, type StaticRoot } from "./staticAssets"
import { injectMobileBootstrap } from "./htmlInjection"

/** Preferred port; falls back to an OS-assigned ephemeral port on EADDRINUSE. */
const DEFAULT_PORT = 8790

/**
 * `context.secrets` key the fixed pairing token is persisted under when
 * `zoo-code.mobileServer.tokenMode` is `"fixed"`. Deliberately not routed
 * through `ContextProxy.getSecret`/`storeSecret` - those are typed against the
 * fixed `SecretStateKey` union in `packages/types`, which is the shared
 * provider-settings secret schema. This is a mobile-server-internal
 * implementation detail, so a direct `context.secrets` call is the right scope.
 */
const FIXED_TOKEN_SECRET_KEY = "zooCode.mobileServer.fixedToken"

type TokenMode = "dynamic" | "fixed"

/**
 * Resolved from `extensionPath` (not `__dirname`): esbuild bundles this module's
 * compiled output into `dist/`, so `__dirname` would point there instead of the
 * `services/mobileServer/assets/` source path that `.vscodeignore` actually ships.
 */
function getMobileThemeCssPath(extensionPath: string): string {
	return path.join(extensionPath, "services", "mobileServer", "assets", "mobile-theme-dark.css")
}

/**
 * Owns the LAN-bound HTTP+WebSocket server that lets a phone browser run the
 * same webview-ui React app as a standalone SPA, talking to the one sidebar
 * `ClineProvider` instance passed in at construction (never
 * `ClineProvider.getVisibleInstance()` - see the mobile-server plan's decision 5:
 * that returns `undefined` whenever the VS Code window is minimized/backgrounded,
 * which is exactly when a phone client is most useful).
 *
 * Structurally mirrors `src/services/mcp/utils/callbackServer.ts`: plain Node
 * `http`, no express/serve-static.
 */
export class MobileServer implements vscode.Disposable {
	private httpServer?: http.Server
	private wss?: WebSocketServer
	private clients = new Set<WebSocket>()
	private postMessageListenerDisposable?: vscode.Disposable
	private statusBarItem?: vscode.StatusBarItem

	private token?: string
	private cookieSecret?: string
	private lanAddress?: string
	private port?: number
	private staticRoots: StaticRoot[] = []
	private mobileThemeCssPath?: string

	private starting = false

	constructor(
		private readonly provider: ClineProvider,
		private readonly outputChannel: vscode.OutputChannel,
		private readonly context: vscode.ExtensionContext,
	) {}

	public get isRunning(): boolean {
		return this.httpServer !== undefined
	}

	/** `http://<lan-ip>:<port>/?token=...` - undefined until `start()` succeeds. */
	public get url(): string | undefined {
		if (!this.lanAddress || !this.port || !this.token) {
			return undefined
		}

		return `http://${this.lanAddress}:${this.port}/?token=${this.token}`
	}

	private getTokenMode(): TokenMode {
		const mode = vscode.workspace.getConfiguration(Package.name).get<string>("mobileServer.tokenMode", "dynamic")
		return mode === "fixed" ? "fixed" : "dynamic"
	}

	/**
	 * Resolves the pairing token to use for an upcoming `start()`. Dynamic mode
	 * (default) keeps today's behavior exactly: a fresh token every start,
	 * never touching persisted storage. Fixed mode reuses whatever's persisted
	 * in `context.secrets`, generating and persisting one on first use.
	 */
	private async resolveStartToken(): Promise<string> {
		if (this.getTokenMode() !== "fixed") {
			return generatePairingToken()
		}

		const existing = await this.context.secrets.get(FIXED_TOKEN_SECRET_KEY)

		if (existing) {
			return existing
		}

		const generated = generatePairingToken()
		await this.context.secrets.store(FIXED_TOKEN_SECRET_KEY, generated)
		return generated
	}

	/**
	 * Rotates the pairing token on demand (the "Regenerate Mobile Server Token"
	 * command). Always clears the persisted fixed token first, then generates a
	 * fresh one and re-persists it if fixed mode is active - regardless of
	 * whether the server is currently running, so the next `start()` (fixed
	 * mode) or this session (if already running) picks up the new value.
	 *
	 * Also rotates `cookieSecret` alongside the token: session cookies are only
	 * signed by `cookieSecret`, not tied to the token value itself, so an
	 * already-paired device would otherwise keep working after a "rotate my
	 * leaked token" action, defeating the point of rotating at all.
	 */
	public async regenerateToken(): Promise<void> {
		await this.context.secrets.delete(FIXED_TOKEN_SECRET_KEY)

		const freshToken = generatePairingToken()
		const tokenMode = this.getTokenMode()

		if (tokenMode === "fixed") {
			await this.context.secrets.store(FIXED_TOKEN_SECRET_KEY, freshToken)
		}

		if (this.isRunning) {
			this.token = freshToken
			this.cookieSecret = generateCookieSecret()

			const url = this.url!
			this.outputChannel.appendLine(`[MobileServer] Token regenerated; now at ${url}`)
			this.showStartedNotification(url)
			return
		}

		// Not running: fixed mode already has its fresh token persisted above,
		// ready for the next start(). Dynamic mode holds no live token outside
		// of a running server, so there's nothing to rotate - say so rather
		// than silently doing nothing.
		if (tokenMode !== "fixed") {
			void vscode.window.showInformationMessage(t("common:mobileServer.info.noActiveTokenToRotate"))
		}
	}

	public async start(): Promise<void> {
		if (this.starting) {
			return
		}

		// Already running - treat a repeat `start()` call (e.g. clicking the status
		// bar item, or re-running the command) as "re-show the link" rather than a
		// no-op, since there's no other way to re-surface it once dismissed.
		if (this.isRunning) {
			if (this.url) {
				this.showStartedNotification(this.url)
			}
			return
		}

		this.starting = true

		try {
			const candidates = listLanAddressCandidates()
			this.outputChannel.appendLine(
				`[MobileServer] LAN address candidates: ${candidates.map((c) => `${c.name}=${c.address}`).join(", ") || "(none)"}`,
			)

			const lanCandidate = getLanAddress()

			if (!lanCandidate) {
				this.outputChannel.appendLine(
					"[MobileServer] No non-internal IPv4 network interface found; not starting.",
				)
				void vscode.window.showErrorMessage(t("common:mobileServer.errors.noLanAddress"))
				return
			}

			this.lanAddress = lanCandidate.address
			this.token = await this.resolveStartToken()
			this.cookieSecret = generateCookieSecret()
			this.staticRoots = buildStaticRoots(this.provider.contextProxy.extensionPath)
			this.mobileThemeCssPath = getMobileThemeCssPath(this.provider.contextProxy.extensionPath)

			this.httpServer = http.createServer((req, res) => {
				void this.handleRequest(req, res)
			})

			this.wss = new WebSocketServer({ noServer: true })

			this.wss.on("connection", (ws) => this.handleConnection(ws))

			this.httpServer.on("upgrade", (req, socket, head) => {
				this.handleUpgrade(req, socket, head)
			})

			// Bind on every interface (0.0.0.0) rather than just the detected LAN
			// address - some setups (extra NICs, certain router/AP configs, Windows
			// binding quirks) fail to accept connections on a single bound address
			// even though the interface is up. `this.lanAddress` is still what gets
			// shown to the user as the URL host, since a phone can't connect to
			// 0.0.0.0 - it just needs to be a real, reachable interface address.
			this.port = await listenWithFallback(this.httpServer, "0.0.0.0", DEFAULT_PORT)

			this.postMessageListenerDisposable = this.provider.addPostMessageListener((message) =>
				this.broadcast(message),
			)

			const url = this.url!
			this.outputChannel.appendLine(`[MobileServer] Started at ${url}`)
			this.showStartedNotification(url)
			this.createStatusBarItem()
		} catch (error) {
			this.outputChannel.appendLine(
				`[MobileServer] Failed to start: ${error instanceof Error ? error.message : String(error)}`,
			)
			void vscode.window.showErrorMessage(
				t("common:mobileServer.errors.startFailed", {
					error: error instanceof Error ? error.message : String(error),
				}),
			)
			await this.stop()
		} finally {
			this.starting = false
		}
	}

	public async stop(): Promise<void> {
		this.postMessageListenerDisposable?.dispose()
		this.postMessageListenerDisposable = undefined

		for (const client of this.clients) {
			try {
				client.close()
			} catch {
				// Ignore - socket may already be closing/closed.
			}
		}
		this.clients.clear()

		if (this.wss) {
			await new Promise<void>((resolve) => this.wss!.close(() => resolve()))
			this.wss = undefined
		}

		if (this.httpServer) {
			const server = this.httpServer
			this.httpServer = undefined
			// `close()` alone waits indefinitely for any still-open (e.g. keep-alive)
			// sockets to end on their own; force them shut so stop()/dispose() can't hang.
			server.closeAllConnections?.()
			await new Promise<void>((resolve) => server.close(() => resolve()))
		}

		this.statusBarItem?.dispose()
		this.statusBarItem = undefined

		this.token = undefined
		this.cookieSecret = undefined
		this.lanAddress = undefined
		this.port = undefined
		this.mobileThemeCssPath = undefined
	}

	public dispose(): void {
		void this.stop()
	}

	// --- HTTP -------------------------------------------------------------

	private isAuthorized(pathnameSearchParams: URLSearchParams, cookieHeader: string | undefined): boolean {
		if (!this.token || !this.cookieSecret) {
			return false
		}

		const cookies = parseCookies(cookieHeader)

		return (
			verifySessionCookie(this.cookieSecret, cookies[SESSION_COOKIE_NAME]) ||
			verifyPairingToken(this.token, pathnameSearchParams.get("token"))
		)
	}

	private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
		const pathname = decodeURIComponent(url.pathname)

		if (!this.isAuthorized(url.searchParams, req.headers.cookie)) {
			res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" })
			res.end("Unauthorized")
			return
		}

		const grantedViaToken = verifyPairingToken(this.token!, url.searchParams.get("token"))
		const alreadyHasSession = verifySessionCookie(
			this.cookieSecret!,
			parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME],
		)
		const setCookieHeader =
			grantedViaToken && !alreadyHasSession
				? buildSessionCookieHeader(createSessionCookie(this.cookieSecret!))
				: undefined

		if (pathname === "/mobile-theme-dark.css" && this.mobileThemeCssPath) {
			await this.serveFixedFile(res, this.mobileThemeCssPath, "text/css; charset=utf-8", setCookieHeader)
			return
		}

		const resolvedPathname = pathname === "/" ? "/index.html" : pathname
		const resolved = resolveStaticFile(resolvedPathname, this.staticRoots)

		if (!resolved) {
			res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
			res.end("Not found")
			return
		}

		const content = await readStaticFile(resolved)

		if (!content) {
			res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
			res.end("Not found")
			return
		}

		const headers: http.OutgoingHttpHeaders = { "Content-Type": resolved.contentType }
		headers["Cache-Control"] = resolved.isIndexHtml ? "no-cache" : "public, max-age=31536000, immutable"

		if (setCookieHeader) {
			headers["Set-Cookie"] = setCookieHeader
		}

		if (resolved.isIndexHtml) {
			const wsUrl = `ws://${this.lanAddress}:${this.port}/ws?token=${this.token}`
			const html = injectMobileBootstrap(content.toString("utf8"), {
				wsUrl,
				imagesBaseUri: "/mobile-assets/images",
				audioBaseUri: "/mobile-assets/audio",
				materialIconsBaseUri: "/mobile-assets/material-icons",
			})
			res.writeHead(200, headers)
			res.end(html)
			return
		}

		res.writeHead(200, headers)
		res.end(content)
	}

	private async serveFixedFile(
		res: http.ServerResponse,
		absolutePath: string,
		contentType: string,
		setCookieHeader: string | undefined,
	): Promise<void> {
		try {
			const content = await fsp.readFile(absolutePath)
			const headers: http.OutgoingHttpHeaders = {
				"Content-Type": contentType,
				"Cache-Control": "public, max-age=31536000, immutable",
			}

			if (setCookieHeader) {
				headers["Set-Cookie"] = setCookieHeader
			}

			res.writeHead(200, headers)
			res.end(content)
		} catch {
			res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
			res.end("Not found")
		}
	}

	// --- WebSocket ----------------------------------------------------------

	private handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)

		if (url.pathname !== "/ws" || !this.isAuthorized(url.searchParams, req.headers.cookie)) {
			socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
			socket.destroy()
			return
		}

		this.wss!.handleUpgrade(req, socket, head, (ws) => {
			this.wss!.emit("connection", ws, req)
		})
	}

	private handleConnection(ws: WebSocket): void {
		this.clients.add(ws)

		ws.on("message", (data) => {
			void this.handleInboundMessage(data)
		})

		ws.on("close", () => this.clients.delete(ws))
		ws.on("error", () => this.clients.delete(ws))
	}

	private async handleInboundMessage(data: unknown): Promise<void> {
		try {
			const raw = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf8") : String(data)
			const message = JSON.parse(raw) as WebviewMessage
			// Mirrors `setWebviewMessageListener` (ClineProvider.ts) - inbound WS
			// messages call the same transport-agnostic handler directly.
			await webviewMessageHandler(this.provider, message, this.provider.marketplaceManager)
		} catch (error) {
			this.outputChannel.appendLine(
				`[MobileServer] Failed to handle inbound WS message: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	private broadcast(message: ExtensionMessage): void {
		if (this.clients.size === 0) {
			return
		}

		const payload = JSON.stringify(message)

		for (const client of this.clients) {
			if (client.readyState === WebSocket.OPEN) {
				client.send(payload)
			}
		}
	}

	// --- UI (Phase D) --------------------------------------------------------

	private showStartedNotification(url: string): void {
		const copyLinkAction = t("common:mobileServer.notification.copyLink")

		void vscode.window
			.showInformationMessage(t("common:mobileServer.notification.running", { url }), copyLinkAction)
			.then((selection) => {
				if (selection === copyLinkAction) {
					void vscode.env.clipboard.writeText(url)
				}
			})
	}

	private createStatusBarItem(): void {
		this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0)
		this.statusBarItem.text = `$(radio-tower) Mobile: ${this.lanAddress}:${this.port}`
		this.statusBarItem.tooltip = t("common:mobileServer.statusBar.tooltip")
		this.statusBarItem.command = {
			title: t("common:mobileServer.notification.copyLink"),
			command: "zoo-code.startMobileServer",
		}
		this.statusBarItem.show()
	}
}

function buildStaticRoots(extensionPath: string): StaticRoot[] {
	return [
		{ urlPrefix: "/mobile-assets/images/", dir: path.join(extensionPath, "assets", "images") },
		{ urlPrefix: "/mobile-assets/audio/", dir: path.join(extensionPath, "webview-ui", "audio") },
		{
			urlPrefix: "/mobile-assets/material-icons/",
			dir: path.join(extensionPath, "assets", "vscode-material-icons", "icons"),
		},
		// Catch-all root, matching the Vite build's `base: "/"` assumption. Must
		// stay last in intent (resolveStaticFile sorts by prefix length, so this
		// empty/shortest prefix is naturally tried after the three roots above).
		{ urlPrefix: "/", dir: path.join(extensionPath, "webview-ui", "build") },
	]
}

/** Tries `preferredPort` first, then falls back to an OS-assigned ephemeral port on EADDRINUSE. */
function listenWithFallback(server: http.Server, host: string, preferredPort: number): Promise<number> {
	return new Promise((resolve, reject) => {
		const onError = (error: NodeJS.ErrnoException) => {
			if (error.code === "EADDRINUSE") {
				server.removeListener("error", onError)
				server.listen(0, host)
			} else {
				reject(error)
			}
		}

		server.once("error", onError)

		server.once("listening", () => {
			server.removeListener("error", onError)
			const address = server.address()

			if (address && typeof address === "object") {
				resolve(address.port)
			} else {
				reject(new Error("Failed to determine listening port"))
			}
		})

		server.listen(preferredPort, host)
	})
}
