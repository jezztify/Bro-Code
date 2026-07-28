import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

/**
 * Minimal fake `WebSocket` - jsdom (this suite's test environment) doesn't
 * implement the WebSocket API at all, and we need full control over
 * open/message/close timing to exercise `vscode.ts`'s mobile WS transport
 * branch (queueing, reconnect backoff, resending `webviewDidLaunch`).
 */
class MockWebSocket {
	static readonly CONNECTING = 0
	static readonly OPEN = 1
	static readonly CLOSING = 2
	static readonly CLOSED = 3
	static instances: MockWebSocket[] = []

	readyState = MockWebSocket.CONNECTING
	sentMessages: string[] = []
	private listeners: Record<string, Array<(event: any) => void>> = {}

	constructor(public readonly url: string) {
		MockWebSocket.instances.push(this)
	}

	addEventListener(type: string, callback: (event: any) => void) {
		;(this.listeners[type] ??= []).push(callback)
	}

	removeEventListener(type: string, callback: (event: any) => void) {
		this.listeners[type] = (this.listeners[type] ?? []).filter((cb) => cb !== callback)
	}

	send(data: string) {
		this.sentMessages.push(data)
	}

	close() {
		this.readyState = MockWebSocket.CLOSED
		this.dispatch("close", {})
	}

	dispatch(type: string, event: any) {
		for (const callback of this.listeners[type] ?? []) {
			callback(event)
		}
	}

	simulateOpen() {
		this.readyState = MockWebSocket.OPEN
		this.dispatch("open", {})
	}
}

async function importFreshVscodeModule() {
	vi.resetModules()
	const mod = await import("../vscode")
	return mod.vscode
}

describe("VSCodeAPIWrapper - mobile WebSocket transport", () => {
	beforeEach(() => {
		MockWebSocket.instances = []
		;(globalThis as any).WebSocket = MockWebSocket
		;(window as any).ZOO_MOBILE_WS_URL = "ws://192.168.1.10:8790/ws?token=abc123"
	})

	afterEach(() => {
		delete (window as any).ZOO_MOBILE_WS_URL
		delete (globalThis as any).WebSocket
		vi.useRealTimers()
	})

	it("opens a WebSocket to the injected URL instead of acquiring the VS Code API", async () => {
		await importFreshVscodeModule()

		expect(MockWebSocket.instances).toHaveLength(1)
		expect(MockWebSocket.instances[0].url).toBe("ws://192.168.1.10:8790/ws?token=abc123")
	})

	it("sends postMessage as JSON over the socket once it's open", async () => {
		const vscode = await importFreshVscodeModule()
		const ws = MockWebSocket.instances[0]
		ws.simulateOpen()
		ws.sentMessages = [] // clear the auto-resent webviewDidLaunch from the open handler

		vscode.postMessage({ type: "newTask", text: "hello" } as any)

		expect(ws.sentMessages).toHaveLength(1)
		expect(JSON.parse(ws.sentMessages[0])).toEqual({ type: "newTask", text: "hello" })
	})

	it("queues messages sent before the socket is open and flushes them once it opens", async () => {
		const vscode = await importFreshVscodeModule()
		const ws = MockWebSocket.instances[0]

		vscode.postMessage({ type: "newTask", text: "queued-while-connecting" } as any)
		expect(ws.sentMessages).toHaveLength(0)

		ws.simulateOpen()

		expect(ws.sentMessages.some((raw) => JSON.parse(raw).text === "queued-while-connecting")).toBe(true)
	})

	it("resends webviewDidLaunch on every successful open", async () => {
		await importFreshVscodeModule()
		const ws = MockWebSocket.instances[0]

		ws.simulateOpen()

		expect(ws.sentMessages.some((raw) => JSON.parse(raw).type === "webviewDidLaunch")).toBe(true)
	})

	it("parses incoming WS JSON frames and dispatches them as window `message` events with an object payload", async () => {
		await importFreshVscodeModule()
		const ws = MockWebSocket.instances[0]
		const handler = vi.fn()
		window.addEventListener("message", handler)

		try {
			// MobileServer sends JSON text frames; every existing
			// `window.addEventListener("message", ...)` consumer
			// (ExtensionStateContext.tsx, App.tsx) expects `event.data` to already
			// be the parsed object, matching what `webview.postMessage()` delivers
			// on desktop - so this must NOT surface as a raw string.
			ws.dispatch("message", { data: JSON.stringify({ type: "state", state: { didHydrateState: true } }) })

			expect(handler).toHaveBeenCalledTimes(1)
			const event = handler.mock.calls[0][0] as MessageEvent
			expect(typeof event.data).toBe("object")
			expect(event.data).toEqual({ type: "state", state: { didHydrateState: true } })
		} finally {
			window.removeEventListener("message", handler)
		}
	})

	it("drops malformed (non-JSON) WS frames instead of propagating a broken payload", async () => {
		await importFreshVscodeModule()
		const ws = MockWebSocket.instances[0]
		const handler = vi.fn()
		window.addEventListener("message", handler)
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		try {
			ws.dispatch("message", { data: "not valid json" })

			expect(handler).not.toHaveBeenCalled()
			expect(errorSpy).toHaveBeenCalled()
		} finally {
			window.removeEventListener("message", handler)
			errorSpy.mockRestore()
		}
	})

	it("reconnects with backoff after the socket closes, and resends webviewDidLaunch on reopen", async () => {
		vi.useFakeTimers()

		await importFreshVscodeModule()
		MockWebSocket.instances[0].close()

		// Not reconnected yet - backoff hasn't elapsed.
		expect(MockWebSocket.instances).toHaveLength(1)

		await vi.advanceTimersByTimeAsync(1000)

		expect(MockWebSocket.instances).toHaveLength(2)

		const reconnected = MockWebSocket.instances[1]
		reconnected.sentMessages = []
		reconnected.simulateOpen()

		expect(reconnected.sentMessages.some((raw) => JSON.parse(raw).type === "webviewDidLaunch")).toBe(true)
	})

	it("dispatches connection-status events for connecting/open/reconnecting", async () => {
		const { ZOO_MOBILE_CONNECTION_EVENT } = await import("../vscode")
		vi.resetModules()
		vi.useFakeTimers()

		const statuses: string[] = []
		const handler = (event: Event) => statuses.push((event as CustomEvent).detail.status)
		window.addEventListener(ZOO_MOBILE_CONNECTION_EVENT, handler)

		try {
			await import("../vscode")
			const ws = MockWebSocket.instances[0]

			expect(statuses).toEqual(["connecting"])

			ws.simulateOpen()
			expect(statuses).toEqual(["connecting", "open"])

			ws.close()
			expect(statuses).toEqual(["connecting", "open", "reconnecting"])
		} finally {
			window.removeEventListener(ZOO_MOBILE_CONNECTION_EVENT, handler)
		}
	})
})

describe("VSCodeAPIWrapper - no mobile WS URL present", () => {
	beforeEach(() => {
		delete (window as any).ZOO_MOBILE_WS_URL
	})

	it("falls back to logging postMessage calls when neither acquireVsCodeApi nor a mobile WS URL are present", async () => {
		const vscode = await importFreshVscodeModule()
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

		try {
			vscode.postMessage({ type: "newTask" } as any)
			expect(logSpy).toHaveBeenCalledWith({ type: "newTask" })
		} finally {
			logSpy.mockRestore()
		}
	})
})
