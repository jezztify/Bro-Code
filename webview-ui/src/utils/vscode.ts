import type { WebviewApi } from "vscode-webview"

import { WebviewMessage } from "@roo/WebviewMessage"

/**
 * Event name dispatched on `window` whenever the mobile WebSocket transport's
 * connection status changes. `MobileConnectionBanner.tsx` listens for this to drive a
 * "Reconnecting..." banner (see the mobile-server plan's Phase D). Not
 * dispatched at all in the desktop (`acquireVsCodeApi`) or no-op modes.
 */
export const ZOO_MOBILE_CONNECTION_EVENT = "zoo-mobile-connection"

export type ZooMobileConnectionStatus = "connecting" | "open" | "reconnecting"

export interface ZooMobileConnectionEventDetail {
	status: ZooMobileConnectionStatus
}

const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 30_000

/**
 * How long the socket may go without any inbound traffic before we treat it as
 * dead and force a reconnect.
 *
 * Browsers answer WebSocket pings transparently but expose no event for them, so
 * a silently dropped connection (phone sleeping, NAT idle timeout, Wi-Fi roam)
 * leaves `readyState` at OPEN forever and the `close` handler below never fires.
 * Browsers answer protocol-level pings without surfacing them to JS, so the
 * server also emits an application-level heartbeat frame every 20s purely so
 * this deadline has something observable to refresh. Any gap this long means
 * the connection is gone whatever `readyState` claims.
 */
const LIVENESS_TIMEOUT_MS = 60_000

/**
 * Server-sent frames handled entirely by the transport. Consumed here rather
 * than re-dispatched, so no `window` "message" consumer has to know they exist.
 */
const HEARTBEAT_MESSAGE_TYPE = "__mobileHeartbeat"
const RELOAD_MESSAGE_TYPE = "mobileReload"

/**
 * A utility wrapper around the acquireVsCodeApi() function, which enables
 * message passing and state management between the webview and extension
 * contexts.
 *
 * This utility also enables webview code to be run in a web browser-based
 * dev server by using native web browser features that mock the functionality
 * enabled by acquireVsCodeApi.
 *
 * A third mode is used when this bundle is served by `MobileServer` to a plain
 * mobile browser (no `acquireVsCodeApi`, no VS Code webview host at all):
 * detected via the `window.ZOO_MOBILE_WS_URL` global injected by
 * `htmlInjection.ts`. In that mode, `postMessage` sends over a WebSocket
 * instead of `vsCodeApi.postMessage`, and inbound WS frames are re-dispatched
 * as `window` `"message"` events so every existing
 * `window.addEventListener("message", ...)` consumer (`ExtensionStateContext.tsx`,
 * `App.tsx`) keeps working completely unmodified.
 */
class VSCodeAPIWrapper {
	private readonly vsCodeApi: WebviewApi<unknown> | undefined
	private readonly mobileWsUrl: string | undefined

	private ws: WebSocket | undefined
	private messageQueue: WebviewMessage[] = []
	private reconnectAttempt = 0
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined
	private livenessTimer: ReturnType<typeof setTimeout> | undefined

	constructor() {
		const mobileWsUrl = (window as unknown as { ZOO_MOBILE_WS_URL?: string }).ZOO_MOBILE_WS_URL

		if (mobileWsUrl) {
			this.mobileWsUrl = mobileWsUrl
			this.connect()
			return
		}

		// Check if the acquireVsCodeApi function exists in the current development
		// context (i.e. VS Code development window or web browser)
		if (typeof acquireVsCodeApi === "function") {
			this.vsCodeApi = acquireVsCodeApi()
		}
	}

	private connect() {
		if (!this.mobileWsUrl) {
			return
		}

		this.dispatchConnectionStatus(this.reconnectAttempt === 0 ? "connecting" : "reconnecting")

		const ws = new WebSocket(this.mobileWsUrl)
		this.ws = ws

		ws.addEventListener("open", () => {
			this.reconnectAttempt = 0
			this.dispatchConnectionStatus("open")
			this.noteLiveness()
			this.flushQueue()

			// Resend `webviewDidLaunch` on every successful (re)open to force the
			// same full-state refresh the desktop webview does once per page load,
			// reusing the existing refresh path instead of inventing a diff/resume
			// protocol (mobile-server plan decision 6). On the very first connect
			// this duplicates the `webviewDidLaunch` `App.tsx` already queued via
			// `postMessage` on mount - harmless, since that handler is idempotent.
			this.sendOverWebSocket({ type: "webviewDidLaunch" })
		})

		ws.addEventListener("message", (event) => {
			// `MobileServer` sends JSON text frames (`client.send(JSON.stringify(message))`),
			// but every existing `window.addEventListener("message", ...)` consumer
			// (`ExtensionStateContext.tsx`, `App.tsx`) expects `event.data` to already
			// be the parsed `ExtensionMessage` object, matching what
			// `webview.postMessage()` delivers on desktop. Parse here so those
			// consumers need no changes.
			// Any inbound frame proves the connection is alive, heartbeats included.
			this.noteLiveness()

			try {
				const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data

				if (data?.type === HEARTBEAT_MESSAGE_TYPE) {
					return
				}

				// Dev-mode nudge from the Vite HMR watcher: the served bundle changed,
				// so reload rather than keep running stale code (see viteDevProxy.ts).
				if (data?.type === RELOAD_MESSAGE_TYPE) {
					window.location.reload()
					return
				}

				window.dispatchEvent(new MessageEvent("message", { data }))
			} catch (error) {
				console.error("Failed to parse WS message from MobileServer:", error)
			}
		})

		ws.addEventListener("close", () => {
			this.clearLivenessTimer()
			this.scheduleReconnect()
		})

		ws.addEventListener("error", () => {
			ws.close()
		})
	}

	/**
	 * Restarts the liveness deadline. On expiry the socket is force-closed, which
	 * runs the `close` handler above and so funnels into the normal reconnect path
	 * rather than duplicating its backoff logic.
	 */
	private noteLiveness() {
		this.clearLivenessTimer()

		this.livenessTimer = setTimeout(() => {
			this.livenessTimer = undefined

			try {
				this.ws?.close()
			} catch {
				// Already closing; the close handler still schedules the reconnect.
			}
		}, LIVENESS_TIMEOUT_MS)
	}

	private clearLivenessTimer() {
		if (this.livenessTimer) {
			clearTimeout(this.livenessTimer)
			this.livenessTimer = undefined
		}
	}

	private scheduleReconnect() {
		if (this.reconnectTimer) {
			return
		}

		const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_DELAY_MS)
		this.reconnectAttempt += 1
		this.dispatchConnectionStatus("reconnecting")

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined
			this.connect()
		}, delay)
	}

	private dispatchConnectionStatus(status: ZooMobileConnectionStatus) {
		window.dispatchEvent(
			new CustomEvent<ZooMobileConnectionEventDetail>(ZOO_MOBILE_CONNECTION_EVENT, { detail: { status } }),
		)
	}

	private flushQueue() {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			return
		}

		const queued = this.messageQueue
		this.messageQueue = []

		for (const message of queued) {
			this.sendOverWebSocket(message)
		}
	}

	private sendOverWebSocket(message: WebviewMessage) {
		// Queue-and-flush if the socket isn't OPEN yet, rather than dropping the
		// message - this covers both the initial connect race (page interaction
		// before the handshake completes) and reconnect windows (flaky Wi-Fi).
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(message))
		} else {
			this.messageQueue.push(message)
		}
	}

	/**
	 * Post a message (i.e. send arbitrary data) to the owner of the webview.
	 *
	 * @remarks When running webview code inside a web browser, postMessage will instead
	 * log the given message to the console.
	 *
	 * @param message Arbitrary data (must be JSON serializable) to send to the extension context.
	 */
	public postMessage(message: WebviewMessage) {
		if (this.mobileWsUrl) {
			this.sendOverWebSocket(message)
		} else if (this.vsCodeApi) {
			this.vsCodeApi.postMessage(message)
		} else {
			console.log(message)
		}
	}

	/**
	 * Get the persistent state stored for this webview.
	 *
	 * @remarks When running webview source code inside a web browser, getState will retrieve state
	 * from local storage (https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).
	 *
	 * @return The current state or `undefined` if no state has been set.
	 */
	public getState(): unknown | undefined {
		if (this.vsCodeApi) {
			return this.vsCodeApi.getState()
		} else {
			const state = localStorage.getItem("vscodeState")
			return state ? JSON.parse(state) : undefined
		}
	}

	/**
	 * Set the persistent state stored for this webview.
	 *
	 * @remarks When running webview source code inside a web browser, setState will set the given
	 * state using local storage (https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).
	 *
	 * @param newState New persisted state. This must be a JSON serializable object. Can be retrieved
	 * using {@link getState}.
	 *
	 * @return The new state.
	 */
	public setState<T extends unknown | undefined>(newState: T): T {
		if (this.vsCodeApi) {
			return this.vsCodeApi.setState(newState)
		} else {
			localStorage.setItem("vscodeState", JSON.stringify(newState))
			return newState
		}
	}
}

// Exports class singleton to prevent multiple invocations of acquireVsCodeApi.
export const vscode = new VSCodeAPIWrapper()
