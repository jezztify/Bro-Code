import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest"
import * as fsp from "fs/promises"
import * as os from "os"
import * as path from "path"
import { WebSocket as WsClient } from "ws"

import { MobileServer } from "../MobileServer"
import { allowNetConnect } from "../../../vitest.setup"

// Deterministic LAN address so this test never depends on the host machine's
// actual network configuration (CI containers may have no LAN interface at
// all - `lanAddress.ts`'s own ranking logic has its dedicated unit tests;
// this integration test only needs *some* bindable, reachable address).
vi.mock("../lanAddress", () => ({
	getLanAddress: () => ({ name: "lo", address: "127.0.0.1", rank: 0 }),
	listLanAddressCandidates: () => [{ name: "lo", address: "127.0.0.1", rank: 0 }],
}))

vi.mock("../../../i18n", () => ({
	t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
}))

// The message-handling logic itself is `webviewMessageHandler`'s own concern
// (with its own test suite) - this integration test only exercises
// MobileServer's HTTP/WS transport plumbing (auth gating), so the handler is
// stubbed out entirely.
vi.mock("../../../core/webview/webviewMessageHandler", () => ({
	webviewMessageHandler: vi.fn().mockResolvedValue(undefined),
}))

// Mutable state read by the `workspace.getConfiguration` mock below, so
// individual tests can flip `zoo-code.mobileServer.tokenMode` without needing
// a fresh vi.mock factory per test. Declared via `vi.hoisted` so it's
// initialized before the (hoisted) `vi.mock("vscode", ...)` factory ever runs.
const configState = vi.hoisted(() => ({ tokenMode: undefined as string | undefined }))

vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn().mockResolvedValue(undefined),
		showErrorMessage: vi.fn().mockResolvedValue(undefined),
		createStatusBarItem: vi.fn(() => ({
			text: "",
			tooltip: "",
			command: undefined,
			show: vi.fn(),
			dispose: vi.fn(),
		})),
	},
	workspace: {
		getConfiguration: vi.fn(() => ({
			get: (key: string, defaultValue?: unknown) =>
				key === "mobileServer.tokenMode" ? (configState.tokenMode ?? defaultValue) : defaultValue,
		})),
	},
	StatusBarAlignment: { Left: 1, Right: 2 },
	env: { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } },
	Disposable: class {
		constructor(private readonly callOnDispose?: () => void) {}
		dispose() {
			this.callOnDispose?.()
		}
	},
}))

function createMockOutputChannel() {
	return {
		appendLine: vi.fn(),
		append: vi.fn(),
		clear: vi.fn(),
		hide: vi.fn(),
		name: "mock",
		replace: vi.fn(),
		show: vi.fn(),
		dispose: vi.fn(),
	} as unknown as import("vscode").OutputChannel
}

function createStubProvider(extensionPath: string) {
	let capturedListener: ((message: unknown) => void) | undefined

	const provider = {
		contextProxy: { extensionPath },
		marketplaceManager: {},
		addPostMessageListener: vi.fn((listener: (message: unknown) => void) => {
			capturedListener = listener
			return { dispose: vi.fn() }
		}),
	} as unknown as import("../../../core/webview/ClineProvider").ClineProvider

	return { provider, emitPostMessage: (message: unknown) => capturedListener?.(message) }
}

/** In-memory `context.secrets` stub so fixed-token persistence can be exercised without real VS Code SecretStorage. */
function createStubContext() {
	const store = new Map<string, string>()

	const context = {
		secrets: {
			get: vi.fn(async (key: string) => store.get(key)),
			store: vi.fn(async (key: string, value: string) => {
				store.set(key, value)
			}),
			delete: vi.fn(async (key: string) => {
				store.delete(key)
			}),
		},
	} as unknown as import("vscode").ExtensionContext

	return context
}

describe("MobileServer", () => {
	let tmpDir: string
	let server: MobileServer

	beforeAll(async () => {
		// This suite makes real loopback HTTP/WS requests against a real server
		// instance (the whole point of an integration test); vitest.setup.ts
		// disables all network access by default via nock.
		allowNetConnect("127.0.0.1")

		tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "zoo-mobile-server-test-"))

		await fsp.mkdir(path.join(tmpDir, "webview-ui", "build", "assets"), { recursive: true })
		await fsp.mkdir(path.join(tmpDir, "webview-ui", "audio"), { recursive: true })
		await fsp.mkdir(path.join(tmpDir, "assets", "images"), { recursive: true })
		await fsp.mkdir(path.join(tmpDir, "assets", "vscode-material-icons", "icons"), { recursive: true })
		await fsp.mkdir(path.join(tmpDir, "services", "mobileServer", "assets"), { recursive: true })

		await fsp.writeFile(
			path.join(tmpDir, "webview-ui", "build", "index.html"),
			`<!doctype html><html><head><script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css"></head><body><div id="root"></div></body></html>`,
		)
		await fsp.writeFile(path.join(tmpDir, "webview-ui", "build", "assets", "index.js"), "console.log('app')")
		await fsp.writeFile(path.join(tmpDir, "webview-ui", "build", "assets", "index.css"), "body{}")
		await fsp.writeFile(path.join(tmpDir, "services", "mobileServer", "assets", "mobile-theme-dark.css"), ":root{}")
	})

	afterAll(async () => {
		await fsp.rm(tmpDir, { recursive: true, force: true })
	})

	beforeEach(() => {
		configState.tokenMode = undefined
	})

	afterEach(async () => {
		await server?.stop()
	})

	async function startServer(context = createStubContext()) {
		const { provider, emitPostMessage } = createStubProvider(tmpDir)
		server = new MobileServer(provider, createMockOutputChannel(), context)
		await server.start()
		expect(server.url).toBeDefined()
		const parsed = new URL(server.url!)
		return { origin: parsed.origin, token: parsed.searchParams.get("token")!, emitPostMessage, context }
	}

	it("rejects an unauthenticated GET with 401", async () => {
		const { origin } = await startServer()

		const response = await fetch(`${origin}/`)

		expect(response.status).toBe(401)
	})

	it("rejects a GET with a wrong token with 401", async () => {
		const { origin } = await startServer()

		const response = await fetch(`${origin}/?token=totally-wrong`)

		expect(response.status).toBe(401)
	})

	it("serves the bootstrapped index.html for an authenticated GET, and issues a session cookie", async () => {
		const { origin, token } = await startServer()

		const response = await fetch(`${origin}/?token=${token}`)
		const body = await response.text()

		expect(response.status).toBe(200)
		expect(body).toContain("window.ZOO_MOBILE_MODE = true;")
		expect(body).toContain("window.ZOO_MOBILE_WS_URL")
		expect(body).toContain("window.IMAGES_BASE_URI")
		expect(response.headers.get("set-cookie")).toContain("zoo_mobile_session=")
	})

	it("serves subsequent requests using only the session cookie (no ?token= needed)", async () => {
		const { origin, token } = await startServer()

		const first = await fetch(`${origin}/?token=${token}`)
		const setCookie = first.headers.get("set-cookie")!
		const cookieValue = setCookie.split(";")[0]

		const second = await fetch(`${origin}/assets/index.js`, { headers: { Cookie: cookieValue } })

		expect(second.status).toBe(200)
		expect(await second.text()).toBe("console.log('app')")
	})

	it("rejects a WebSocket upgrade without a token", async () => {
		const { origin } = await startServer()
		const wsUrl = origin.replace("http", "ws") + "/ws"

		const rejection = await new Promise<{ rejected: boolean; statusCode?: number }>((resolve) => {
			const ws = new WsClient(wsUrl)
			ws.on("open", () => resolve({ rejected: false }))
			ws.on("unexpected-response", (_req, res) => {
				resolve({ rejected: true, statusCode: res.statusCode })
			})
			ws.on("error", () => resolve({ rejected: true }))
		})

		expect(rejection.rejected).toBe(true)
	})

	it("accepts a WebSocket upgrade with a valid token", async () => {
		const { origin, token } = await startServer()
		const wsUrl = `${origin.replace("http", "ws")}/ws?token=${token}`

		const opened = await new Promise<boolean>((resolve) => {
			const ws = new WsClient(wsUrl)
			ws.on("open", () => {
				ws.close()
				resolve(true)
			})
			ws.on("unexpected-response", () => resolve(false))
			ws.on("error", () => resolve(false))
		})

		expect(opened).toBe(true)
	})

	it("fans out provider postMessage broadcasts to connected WS clients as JSON", async () => {
		const { origin, token, emitPostMessage } = await startServer()
		const wsUrl = `${origin.replace("http", "ws")}/ws?token=${token}`

		const received = await new Promise<unknown>((resolve, reject) => {
			const ws = new WsClient(wsUrl)
			ws.on("open", () => {
				// Simulate ClineProvider.postMessageToWebview firing while this WS
				// client is connected - MobileServer subscribed to this via
				// `provider.addPostMessageListener` at start().
				emitPostMessage({ type: "state", state: { didHydrateState: true } })
			})
			ws.on("message", (data) => {
				ws.close()
				resolve(JSON.parse(data.toString()))
			})
			ws.on("error", reject)
		})

		expect(received).toEqual({ type: "state", state: { didHydrateState: true } })
	})

	it("returns 404 for an unknown path", async () => {
		const { origin, token } = await startServer()

		const response = await fetch(`${origin}/does-not-exist.txt?token=${token}`)

		expect(response.status).toBe(404)
	})

	describe("token modes", () => {
		it("dynamic mode (default): produces a different token on every start/stop cycle", async () => {
			const context = createStubContext()

			const { token: firstToken } = await startServer(context)
			await server.stop()

			const { token: secondToken } = await startServer(context)

			expect(secondToken).not.toBe(firstToken)
			// Dynamic mode never touches persisted secret storage.
			expect(context.secrets.store).not.toHaveBeenCalled()
		})

		it("fixed mode: generates and persists a token on first start, then reuses it across restarts", async () => {
			configState.tokenMode = "fixed"
			const context = createStubContext()

			const { token: firstToken } = await startServer(context)
			expect(context.secrets.store).toHaveBeenCalledWith("zooCode.mobileServer.fixedToken", firstToken)
			await server.stop()

			const { token: secondToken } = await startServer(context)

			expect(secondToken).toBe(firstToken)
			// Reusing the persisted token on the second start shouldn't re-store it.
			expect(context.secrets.store).toHaveBeenCalledTimes(1)
		})

		describe("regenerateToken", () => {
			it("fixed mode while running: rotates the token, re-notifies with the new URL, and persists the new token for the next restart", async () => {
				configState.tokenMode = "fixed"
				const context = createStubContext()

				const { token: originalToken } = await startServer(context)

				await server.regenerateToken()

				const rotatedToken = new URL(server.url!).searchParams.get("token")
				expect(rotatedToken).not.toBe(originalToken)

				const vscodeModule = await import("vscode")
				expect(vscodeModule.window.showInformationMessage).toHaveBeenCalledWith(
					expect.stringContaining(rotatedToken!),
					expect.anything(),
				)

				expect(context.secrets.store).toHaveBeenCalledWith("zooCode.mobileServer.fixedToken", rotatedToken)

				// A subsequent restart must reuse the rotated token, not the original.
				await server.stop()
				const { token: afterRestartToken } = await startServer(context)
				expect(afterRestartToken).toBe(rotatedToken)
			})

			it("dynamic mode with no server running: does not throw and shows an informational message", async () => {
				const context = createStubContext()
				const { provider } = createStubProvider(tmpDir)
				server = new MobileServer(provider, createMockOutputChannel(), context)

				await expect(server.regenerateToken()).resolves.not.toThrow()

				const vscodeModule = await import("vscode")
				expect(vscodeModule.window.showInformationMessage).toHaveBeenCalledWith(
					"common:mobileServer.info.noActiveTokenToRotate",
				)
			})
		})
	})
})
