// pnpm --filter roo-cline test core/webview/__tests__/ClineProvider.taskHistory.spec.ts

import * as vscode from "vscode"
import type { HistoryItem, ExtensionMessage } from "@roo-code/types"
import { RooCodeEventName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { ContextProxy } from "../../config/ContextProxy"
import { BoardStore } from "../../board/BoardStore"
import { ClineProvider } from "../ClineProvider"

// Mock setup
vi.mock("p-wait-for", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockResolvedValue(""),
	readdir: vi.fn().mockResolvedValue([]),
	unlink: vi.fn().mockResolvedValue(undefined),
	rmdir: vi.fn().mockResolvedValue(undefined),
	access: vi.fn().mockResolvedValue(undefined),
	rm: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("axios", () => ({
	default: {
		get: vi.fn().mockResolvedValue({ data: { data: [] } }),
		post: vi.fn(),
	},
	get: vi.fn().mockResolvedValue({ data: { data: [] } }),
	post: vi.fn(),
}))

vi.mock("delay", () => {
	const delayFn = (_ms: number) => Promise.resolve()
	delayFn.createDelay = () => delayFn
	delayFn.reject = () => Promise.reject(new Error("Delay rejected"))
	delayFn.range = () => Promise.resolve()
	return { default: delayFn }
})

vi.mock("../../prompts/sections/custom-instructions")

vi.mock("../../../utils/storage", () => ({
	getSettingsDirectoryPath: vi.fn().mockResolvedValue("/test/settings/path"),
	getTaskDirectoryPath: vi.fn().mockResolvedValue("/test/task/path"),
	getGlobalStoragePath: vi.fn().mockResolvedValue("/test/storage/path"),
	getStorageBasePath: vi.fn().mockImplementation((defaultPath: string) => {
		return defaultPath
	}),
}))

vi.mock("../../../utils/safeWriteJson", () => ({
	safeWriteJson: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
	CallToolResultSchema: {},
	ListResourcesResultSchema: {},
	ListResourceTemplatesResultSchema: {},
	ListToolsResultSchema: {},
	ReadResourceResultSchema: {},
	ErrorCode: {
		InvalidRequest: "InvalidRequest",
		MethodNotFound: "MethodNotFound",
		InternalError: "InternalError",
	},
	McpError: class McpError extends Error {
		code: string
		constructor(code: string, message: string) {
			super(message)
			this.code = code
			this.name = "McpError"
		}
	},
}))

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: vi.fn().mockImplementation(function () {
		return {
			connect: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined),
			listTools: vi.fn().mockResolvedValue({ tools: [] }),
			callTool: vi.fn().mockResolvedValue({ content: [] }),
		}
	}),
}))

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
	StdioClientTransport: vi.fn().mockImplementation(function () {
		return {
			connect: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined),
		}
	}),
}))

vi.mock("vscode", () => ({
	ExtensionContext: vi.fn(),
	OutputChannel: vi.fn(),
	WebviewView: vi.fn(),
	Uri: {
		joinPath: vi.fn(),
		file: vi.fn(),
	},
	CodeActionKind: {
		QuickFix: { value: "quickfix" },
		RefactorRewrite: { value: "refactor.rewrite" },
	},
	commands: {
		executeCommand: vi.fn().mockResolvedValue(undefined),
	},
	window: {
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
	},
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn().mockReturnValue([]),
			update: vi.fn(),
		}),
		onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
		onDidChangeConfiguration: vi.fn().mockImplementation(() => {
			return {
				dispose: vi.fn(),
			}
		}),
		onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
	},
	env: {
		uriScheme: "vscode",
		language: "en",
		appName: "Visual Studio Code",
	},
	ExtensionMode: {
		Production: 1,
		Development: 2,
		Test: 3,
	},
	version: "1.85.0",
}))

vi.mock("../../../utils/tts", () => ({
	setTtsEnabled: vi.fn(),
	setTtsSpeed: vi.fn(),
}))

vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn().mockReturnValue({
		getModel: vi.fn().mockReturnValue({
			id: "claude-3-sonnet",
		}),
	}),
}))

vi.mock("../../prompts/system", () => ({
	SYSTEM_PROMPT: vi.fn().mockImplementation(async () => "mocked system prompt"),
	codeMode: "code",
}))

vi.mock("../../../integrations/workspace/WorkspaceTracker", () => {
	return {
		default: vi.fn().mockImplementation(function () {
			return {
				initializeFilePaths: vi.fn(),
				dispose: vi.fn(),
			}
		}),
	}
})

vi.mock("../../task/Task", () => ({
	Task: vi.fn().mockImplementation(function (options: any) {
		return {
			api: undefined,
			abortTask: vi.fn(),
			handleWebviewAskResponse: vi.fn(),
			clineMessages: [],
			apiConversationHistory: [],
			overwriteClineMessages: vi.fn(),
			overwriteApiConversationHistory: vi.fn(),
			getTaskNumber: vi.fn().mockReturnValue(0),
			setTaskNumber: vi.fn(),
			setParentTask: vi.fn(),
			setRootTask: vi.fn(),
			taskId: options?.historyItem?.id || "test-task-id",
			emit: vi.fn(),
		}
	}),
}))

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockResolvedValue("file content"),
}))

vi.mock("../../../api/providers/fetchers/modelCache", () => ({
	getModels: vi.fn().mockResolvedValue({}),
	flushModels: vi.fn(),
	getModelsFromCache: vi.fn().mockReturnValue(undefined),
}))

vi.mock("../../../shared/modes", () => ({
	modes: [{ slug: "code", name: "Code Mode", roleDefinition: "You are a code assistant", groups: ["read", "edit"] }],
	getModeBySlug: vi.fn().mockReturnValue({
		slug: "code",
		name: "Code Mode",
		roleDefinition: "You are a code assistant",
		groups: ["read", "edit"],
	}),
	getGroupName: vi.fn().mockReturnValue("General Tools"),
	defaultModeSlug: "code",
}))

vi.mock("../diff/strategies/multi-search-replace", () => ({
	MultiSearchReplaceDiffStrategy: vi.fn().mockImplementation(function () {
		return {
			getName: () => "test-strategy",
			applyDiff: vi.fn(),
		}
	}),
}))

vi.mock("@roo-code/cloud", () => ({
	CloudService: {
		hasInstance: vi.fn().mockReturnValue(true),
		get instance() {
			return {
				isAuthenticated: vi.fn().mockReturnValue(false),
				getAllowList: vi.fn().mockResolvedValue("*"),
				getUserInfo: vi.fn().mockReturnValue(null),
				canShareTask: vi.fn().mockResolvedValue(false),
				canSharePublicly: vi.fn().mockResolvedValue(false),
				getOrganizationSettings: vi.fn().mockReturnValue(null),
				getOrganizationMemberships: vi.fn().mockResolvedValue([]),
				getUserSettings: vi.fn().mockReturnValue(null),
				isTaskSyncEnabled: vi.fn().mockReturnValue(false),
			}
		},
	},
	getRooCodeApiUrl: vi.fn().mockReturnValue("https://app.roocode.com"),
}))

afterAll(() => {
	vi.restoreAllMocks()
})

describe("ClineProvider Task History Synchronization", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockWebviewView: vscode.WebviewView
	let mockPostMessage: ReturnType<typeof vi.fn>
	let taskHistoryState: HistoryItem[]

	beforeEach(async () => {
		vi.clearAllMocks()
		// BoardStore is shared per storage path so every provider in a host sees one
		// board. Every test here builds a provider over the same mocked path, so
		// without this each would start holding the previous test's cards.
		BoardStore.resetInstancesForTests()

		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		// Initialize task history state
		taskHistoryState = []

		const globalState: Record<string, any> = {
			mode: "code",
			currentApiConfigName: "current-config",
			taskHistory: taskHistoryState,
		}

		const secrets: Record<string, string | undefined> = {}

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: { fsPath: "/test/path" } as vscode.Uri,
			globalState: {
				get: vi.fn().mockImplementation((key: string) => {
					return globalState[key]
				}),
				update: vi.fn().mockImplementation((key: string, value: any) => {
					globalState[key] = value
					if (key === "taskHistory") {
						taskHistoryState = value
					}
				}),
				keys: vi.fn().mockImplementation(() => {
					return Object.keys(globalState)
				}),
			},
			secrets: {
				get: vi.fn().mockImplementation((key: string) => {
					return secrets[key]
				}),
				store: vi.fn().mockImplementation((key: string, value: string | undefined) => {
					return (secrets[key] = value)
				}),
				delete: vi.fn().mockImplementation((key: string) => {
					return delete secrets[key]
				}),
			},
			workspaceState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			subscriptions: [],
			extension: {
				packageJSON: { version: "1.0.0" },
			},
			globalStorageUri: {
				fsPath: "/test/storage/path",
			},
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = {
			appendLine: vi.fn(),
			clear: vi.fn(),
			dispose: vi.fn(),
		} as unknown as vscode.OutputChannel

		mockPostMessage = vi.fn()

		mockWebviewView = {
			webview: {
				postMessage: mockPostMessage,
				html: "",
				options: {},
				onDidReceiveMessage: vi.fn(),
				asWebviewUri: vi.fn(),
				cspSource: "vscode-webview://test-csp-source",
			},
			visible: true,
			onDidDispose: vi.fn().mockImplementation((callback) => {
				callback()
				return { dispose: vi.fn() }
			}),
			onDidChangeVisibility: vi.fn().mockImplementation(() => {
				return { dispose: vi.fn() }
			}),
		} as unknown as vscode.WebviewView

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))

		// Wait for the async TaskHistoryStore initialization to complete
		// (fire-and-forget from the constructor; microtasks need to flush)
		await new Promise((resolve) => setTimeout(resolve, 10))

		// Mock the custom modes manager
		;(provider as any).customModesManager = {
			updateCustomMode: vi.fn().mockResolvedValue(undefined),
			getCustomModes: vi.fn().mockResolvedValue([]),
			dispose: vi.fn(),
		}

		// Mock getMcpHub
		provider.getMcpHub = vi.fn().mockReturnValue({
			listTools: vi.fn().mockResolvedValue([]),
			callTool: vi.fn().mockResolvedValue({ content: [] }),
			listResources: vi.fn().mockResolvedValue([]),
			readResource: vi.fn().mockResolvedValue({ contents: [] }),
			getAllServers: vi.fn().mockReturnValue([]),
		})
	})

	// Helper to create valid HistoryItem with required fields
	const createHistoryItem = (overrides: Partial<HistoryItem> & { id: string; task: string }): HistoryItem => ({
		number: 1,
		ts: Date.now(),
		tokensIn: 100,
		tokensOut: 50,
		totalCost: 0.01,
		...overrides,
	})

	// Helper to find calls by message type
	const findCallsByType = (calls: any[][], type: string) => {
		return calls.filter((call) => call[0]?.type === type)
	}

	describe("updateTaskHistory", () => {
		it("broadcasts task history update by default", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			const historyItem = createHistoryItem({
				id: "task-1",
				task: "Test task",
			})

			await provider.updateTaskHistory(historyItem)

			// Should have called postMessage with taskHistoryItemUpdated
			const taskHistoryItemUpdatedCalls = findCallsByType(mockPostMessage.mock.calls, "taskHistoryItemUpdated")

			expect(taskHistoryItemUpdatedCalls.length).toBeGreaterThanOrEqual(1)

			const lastCall = taskHistoryItemUpdatedCalls[taskHistoryItemUpdatedCalls.length - 1]
			expect(lastCall[0].type).toBe("taskHistoryItemUpdated")
			expect(lastCall[0].taskHistoryItem).toBeDefined()
			expect(lastCall[0].taskHistoryItem.id).toBe("task-1")
		})

		it("does not broadcast when broadcast option is false", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			// Clear previous calls
			mockPostMessage.mockClear()

			const historyItem = createHistoryItem({
				id: "task-2",
				task: "Test task 2",
			})

			await provider.updateTaskHistory(historyItem, { broadcast: false })

			// Should NOT have called postMessage with taskHistoryItemUpdated
			const taskHistoryItemUpdatedCalls = findCallsByType(mockPostMessage.mock.calls, "taskHistoryItemUpdated")

			expect(taskHistoryItemUpdatedCalls.length).toBe(0)
		})

		it("does not broadcast when view is not launched", async () => {
			// Do not resolve webview and keep isViewLaunched false
			provider.isViewLaunched = false

			const historyItem = createHistoryItem({
				id: "task-3",
				task: "Test task 3",
			})

			await provider.updateTaskHistory(historyItem)

			// Should NOT have called postMessage with taskHistoryItemUpdated
			const taskHistoryItemUpdatedCalls = findCallsByType(mockPostMessage.mock.calls, "taskHistoryItemUpdated")

			expect(taskHistoryItemUpdatedCalls.length).toBe(0)
		})

		it("preserves delegated metadata on partial update unless explicitly overwritten (UTH-02)", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			const initial = createHistoryItem({
				id: "task-delegated-metadata",
				task: "Delegated task",
				status: "delegated",
				delegatedToId: "child-1",
				awaitingChildId: "child-1",
				childIds: ["child-1"],
			})

			await provider.updateTaskHistory(initial, { broadcast: false })

			// Partial update intentionally omits delegated metadata fields.
			const partialUpdate: HistoryItem = {
				...createHistoryItem({ id: "task-delegated-metadata", task: "Delegated task (updated)" }),
				status: "active",
			}

			const updatedHistory = await provider.updateTaskHistory(partialUpdate, { broadcast: false })
			const updatedItem = updatedHistory.find((item) => item.id === "task-delegated-metadata")

			expect(updatedItem).toBeDefined()
			expect(updatedItem?.status).toBe("active")
			expect(updatedItem?.delegatedToId).toBe("child-1")
			expect(updatedItem?.awaitingChildId).toBe("child-1")
			expect(updatedItem?.childIds).toEqual(["child-1"])
		})

		it("invalidates recentTasksCache on updateTaskHistory (UTH-04)", async () => {
			const workspace = provider.cwd
			const tsBase = Date.now()

			await provider.updateTaskHistory(
				createHistoryItem({
					id: "cache-seed",
					task: "Cache seed",
					workspace,
					ts: tsBase,
				}),
				{ broadcast: false },
			)

			const initialRecent = provider.getRecentTasks()
			expect(initialRecent).toContain("cache-seed")

			// Prime cache and verify internal cache is set.
			expect((provider as unknown as { recentTasksCache?: string[] }).recentTasksCache).toEqual(initialRecent)

			await provider.updateTaskHistory(
				createHistoryItem({
					id: "cache-new",
					task: "Cache new",
					workspace,
					ts: tsBase + 1,
				}),
				{ broadcast: false },
			)

			// Direct assertion for invalidation side-effect.
			expect((provider as unknown as { recentTasksCache?: string[] }).recentTasksCache).toBeUndefined()

			const recomputedRecent = provider.getRecentTasks()
			expect(recomputedRecent).toContain("cache-new")
		})

		it("updates existing task in history", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			const historyItem = createHistoryItem({
				id: "task-update",
				task: "Original task",
			})

			await provider.updateTaskHistory(historyItem)

			// Update the same task
			const updatedItem: HistoryItem = {
				...historyItem,
				task: "Updated task",
				tokensIn: 200,
			}

			await provider.updateTaskHistory(updatedItem)

			// Verify the update was persisted in the store
			const storeHistory = provider.taskHistoryStore.getAll()
			expect(storeHistory).toEqual(
				expect.arrayContaining([expect.objectContaining({ id: "task-update", task: "Updated task" })]),
			)

			// Should not have duplicates
			const matchingItems = storeHistory.filter((item: HistoryItem) => item.id === "task-update")
			expect(matchingItems.length).toBe(1)
		})

		it("returns the updated task history array", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			const historyItem = createHistoryItem({
				id: "task-return",
				task: "Return test task",
			})

			const result = await provider.updateTaskHistory(historyItem)

			expect(Array.isArray(result)).toBe(true)
			expect(result.some((item) => item.id === "task-return")).toBe(true)
		})
	})

	describe("broadcastTaskHistoryUpdate", () => {
		it("sends taskHistoryUpdated message with sorted history", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			const now = Date.now()
			const items: HistoryItem[] = [
				createHistoryItem({ id: "old", ts: now - 10000, task: "Old task" }),
				createHistoryItem({ id: "new", ts: now, task: "New task", number: 2 }),
			]

			// Clear previous calls
			mockPostMessage.mockClear()

			await provider.broadcastTaskHistoryUpdate(items)

			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "taskHistoryUpdated",
					taskHistory: expect.any(Array),
				}),
			)

			// Verify the history is sorted (newest first)
			const calls = mockPostMessage.mock.calls as any[][]
			const call = calls.find((c) => c[0]?.type === "taskHistoryUpdated")
			const sentHistory = call?.[0]?.taskHistory as HistoryItem[]
			expect(sentHistory[0].id).toBe("new") // Newest should be first
			expect(sentHistory[1].id).toBe("old") // Oldest should be second
		})

		it("filters out invalid history items", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			const now = Date.now()
			const items: HistoryItem[] = [
				createHistoryItem({ id: "valid", ts: now, task: "Valid task" }),
				createHistoryItem({ id: "no-ts", ts: 0, task: "No timestamp", number: 2 }), // Invalid: ts is 0/falsy
				createHistoryItem({ id: "no-task", ts: now, task: "", number: 3 }), // Invalid: empty task
			]

			// Clear previous calls
			mockPostMessage.mockClear()

			await provider.broadcastTaskHistoryUpdate(items)

			const calls = mockPostMessage.mock.calls as any[][]
			const call = calls.find((c) => c[0]?.type === "taskHistoryUpdated")
			const sentHistory = call?.[0]?.taskHistory as HistoryItem[]

			// Only valid item should be included
			expect(sentHistory.length).toBe(1)
			expect(sentHistory[0].id).toBe("valid")
		})

		it("reads from store when no history is provided", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			// Populate the store with an item
			const now = Date.now()
			await provider.updateTaskHistory(createHistoryItem({ id: "from-store", ts: now, task: "Store task" }), {
				broadcast: false,
			})

			// Clear previous calls
			mockPostMessage.mockClear()

			await provider.broadcastTaskHistoryUpdate()

			const calls = mockPostMessage.mock.calls as any[][]
			const call = calls.find((c) => c[0]?.type === "taskHistoryUpdated")
			const sentHistory = call?.[0]?.taskHistory as HistoryItem[]

			expect(sentHistory.length).toBeGreaterThanOrEqual(1)
			expect(sentHistory.some((item) => item.id === "from-store")).toBe(true)
		})
	})

	describe("task history includes all workspaces", () => {
		it("getStateToPostToWebview returns tasks from all workspaces", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			const now = Date.now()

			// Populate the store with multi-workspace items
			await provider.updateTaskHistory(
				createHistoryItem({
					id: "ws1-task",
					ts: now,
					task: "Workspace 1 task",
					workspace: "/path/to/workspace1",
				}),
				{ broadcast: false },
			)
			await provider.updateTaskHistory(
				createHistoryItem({
					id: "ws2-task",
					ts: now - 1000,
					task: "Workspace 2 task",
					workspace: "/path/to/workspace2",
					number: 2,
				}),
				{ broadcast: false },
			)
			await provider.updateTaskHistory(
				createHistoryItem({
					id: "ws3-task",
					ts: now - 2000,
					task: "Workspace 3 task",
					workspace: "/different/workspace",
					number: 3,
				}),
				{ broadcast: false },
			)

			const state = await provider.getStateToPostToWebview()

			// All tasks from all workspaces should be included
			expect(state.taskHistory.length).toBe(3)
			expect(state.taskHistory.some((item: HistoryItem) => item.workspace === "/path/to/workspace1")).toBe(true)
			expect(state.taskHistory.some((item: HistoryItem) => item.workspace === "/path/to/workspace2")).toBe(true)
			expect(state.taskHistory.some((item: HistoryItem) => item.workspace === "/different/workspace")).toBe(true)
		})
	})

	describe("taskHistory write lock (mutex)", () => {
		it("serializes concurrent updateTaskHistory calls so no entries are lost", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Fire 5 concurrent updateTaskHistory calls
			const items = Array.from({ length: 5 }, (_, i) =>
				createHistoryItem({ id: `concurrent-${i}`, task: `Task ${i}` }),
			)

			await Promise.all(items.map((item) => provider.updateTaskHistory(item, { broadcast: false })))

			// All 5 entries must survive (read from store, not debounced globalState)
			const history = provider.taskHistoryStore.getAll()
			const ids = history.map((h: HistoryItem) => h.id)
			for (const item of items) {
				expect(ids).toContain(item.id)
			}
			expect(history.length).toBe(5)
		})

		it("serializes concurrent update and deleteTaskFromState so they don't corrupt each other", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Seed with two items
			const keep = createHistoryItem({ id: "keep-me", task: "Keep" })
			const remove = createHistoryItem({ id: "remove-me", task: "Remove" })
			await provider.updateTaskHistory(keep, { broadcast: false })
			await provider.updateTaskHistory(remove, { broadcast: false })

			// Concurrently: add a new item AND delete "remove-me"
			const newItem = createHistoryItem({ id: "new-item", task: "New" })
			await Promise.all([
				provider.updateTaskHistory(newItem, { broadcast: false }),
				provider.deleteTaskFromState("remove-me"),
			])

			const history = provider.taskHistoryStore.getAll()
			const ids = history.map((h: HistoryItem) => h.id)
			expect(ids).toContain("keep-me")
			expect(ids).toContain("new-item")
			expect(ids).not.toContain("remove-me")
		})

		it("does not block subsequent writes when a previous store write errors", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Temporarily make the store's safeWriteJson throw
			const { safeWriteJson } = await import("../../../utils/safeWriteJson")
			const mockSafeWriteJson = vi.mocked(safeWriteJson)
			let callCount = 0
			mockSafeWriteJson.mockImplementation(async () => {
				callCount++
				if (callCount === 1) {
					throw new Error("simulated write failure")
				}
			})

			// First call should fail (store write failure)
			const item1 = createHistoryItem({ id: "fail-item", task: "Fail" })
			await expect(provider.updateTaskHistory(item1, { broadcast: false })).rejects.toThrow(
				"simulated write failure",
			)

			// Restore mock
			mockSafeWriteJson.mockResolvedValue(undefined)

			// Second call should still succeed (store lock not stuck)
			const item2 = createHistoryItem({ id: "ok-item", task: "OK" })
			const result = await provider.updateTaskHistory(item2, { broadcast: false })
			expect(result.some((h) => h.id === "ok-item")).toBe(true)
		})

		it("serializes concurrent updates to the same item preserving the last write", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			const base = createHistoryItem({ id: "race-item", task: "Original" })
			await provider.updateTaskHistory(base, { broadcast: false })

			// Fire two concurrent updates to the same item
			await Promise.all([
				provider.updateTaskHistory(createHistoryItem({ id: "race-item", task: "Original", tokensIn: 111 }), {
					broadcast: false,
				}),
				provider.updateTaskHistory(createHistoryItem({ id: "race-item", task: "Original", tokensIn: 222 }), {
					broadcast: false,
				}),
			])

			const history = provider.taskHistoryStore.getAll()
			const item = history.find((h: HistoryItem) => h.id === "race-item")
			expect(item).toBeDefined()
			// The second write (tokensIn: 222) should be the last one since writes are serialized
			expect(item!.tokensIn).toBe(222)
		})
	})

	describe("taskCreationCallback — onTaskCompleted listener", () => {
		function makeFakeTask(taskId: string) {
			const listeners: Record<string, ((...args: unknown[]) => unknown)[]> = {}
			return {
				taskId,
				on: (event: string, fn: (...args: unknown[]) => unknown) => {
					listeners[event] = listeners[event] ?? []
					listeners[event].push(fn)
				},
				// Returns a promise that resolves when all async listeners have settled.
				emit: async (event: string, ...args: unknown[]) => {
					await Promise.all((listeners[event] ?? []).map((fn) => Promise.resolve(fn(...args))))
				},
			}
		}

		it("writes completed status when task is not already completed", async () => {
			const existing = createHistoryItem({ id: "task-cb-1", task: "T" })
			await provider.updateTaskHistory(existing, { broadcast: false })

			const fakeTask = makeFakeTask("task-cb-1")
			;(provider as any).taskCreationCallback(fakeTask)

			await fakeTask.emit(RooCodeEventName.TaskCompleted, "task-cb-1", {}, {})

			const stored = provider.taskHistoryStore.get("task-cb-1")
			expect(stored?.status).toBe("completed")
		})

		it("skips the write when task is already completed", async () => {
			const existing = createHistoryItem({ id: "task-cb-2", task: "T", status: "completed" })
			await provider.updateTaskHistory(existing, { broadcast: false })

			const updateSpy = vi.spyOn(provider, "updateTaskHistory")

			const fakeTask = makeFakeTask("task-cb-2")
			;(provider as any).taskCreationCallback(fakeTask)

			await fakeTask.emit(RooCodeEventName.TaskCompleted, "task-cb-2", {}, {})

			// updateTaskHistory is called initially to store the item, but should NOT be
			// called again by onTaskCompleted since it's already completed.
			const onTaskCompletedCalls = updateSpy.mock.calls.filter((c) => {
				const item = c[0] as HistoryItem
				return item?.id === "task-cb-2" && item?.status === "completed"
			})
			// It was written with completed status already; the callback must not re-write.
			expect(onTaskCompletedCalls.length).toBe(0)
		})

		it("logs and does not throw when updateTaskHistory rejects", async () => {
			const existing = createHistoryItem({ id: "task-cb-3", task: "T" })
			await provider.updateTaskHistory(existing, { broadcast: false })

			vi.spyOn(provider, "updateTaskHistory").mockRejectedValueOnce(new Error("disk full"))
			const logSpy = vi.spyOn(provider as any, "log")

			const fakeTask = makeFakeTask("task-cb-3")
			;(provider as any).taskCreationCallback(fakeTask)

			await fakeTask.emit(RooCodeEventName.TaskCompleted, "task-cb-3", {}, {})

			expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[onTaskCompleted] Failed to write"))
		})
	})

	describe("board task execution", () => {
		function makeFakeTask(taskId: string) {
			const listeners: Record<string, ((...args: unknown[]) => unknown)[]> = {}
			return {
				taskId,
				on: (event: string, fn: (...args: unknown[]) => unknown) => {
					listeners[event] = listeners[event] ?? []
					listeners[event].push(fn)
				},
				emit: async (event: string, ...args: unknown[]) => {
					await Promise.all((listeners[event] ?? []).map((fn) => Promise.resolve(fn(...args))))
				},
			}
		}

		async function createBoardCard(title = "Board task") {
			await provider.boardStore.createWorkspace("Planning")
			const workspaceId = provider.boardStore.getSnapshot().selectedWorkspaceId!
			await provider.boardStore.createTask({ workspaceId, title })
			return provider.boardStore.getSnapshot().tasks[0]!
		}

		it("creates exactly one execution task for concurrent starts", async () => {
			const card = await createBoardCard()
			let releaseCreate!: () => void
			const createStarted = new Promise<void>((resolve) => {
				releaseCreate = resolve
			})
			const createTask = vi.spyOn(provider, "createTask").mockImplementation(
				async () =>
					await new Promise<any>((resolve) => {
						void createStarted.then(() => resolve({ taskId: "execution-1" }))
					}),
			)

			const firstStart = provider.startBoardTask(card.id)
			const secondStart = provider.startBoardTask(card.id)
			// createTask stays blocked until releaseCreate, so this only has to outlast
			// the claim being taken - not a particular number of microtasks.
			await new Promise((resolve) => setTimeout(resolve, 0))
			expect(createTask).toHaveBeenCalledTimes(1)
			releaseCreate()
			await Promise.all([firstStart, secondStart])

			expect(provider.boardStore.getSnapshot().tasks[0]?.linkedHistoryTaskId).toBe("execution-1")
		})

		it("leaves the card unlinked when execution task creation fails", async () => {
			const card = await createBoardCard()
			vi.spyOn(provider, "createTask").mockRejectedValueOnce(new Error("creation failed"))

			await expect(provider.startBoardTask(card.id)).rejects.toThrow("creation failed")
			expect(provider.boardStore.getSnapshot().tasks[0]?.linkedHistoryTaskId).toBeUndefined()
		})

		it("starts a card in the mode assigned to its column", async () => {
			const card = await createBoardCard()
			await provider.boardStore.updateTask(card.id, { stage: "approved" })
			await provider.boardStore.setColumnMode(card.workspaceId, "approved", "code")
			const createTask = vi.spyOn(provider, "createTask").mockResolvedValue({ taskId: "execution-mode" } as any)

			await provider.startBoardTask(card.id)

			expect(createTask).toHaveBeenCalledWith("Board task", undefined, undefined, { initialMode: "code" }, {})
		})

		it("starts a card in the current mode when its column has none", async () => {
			const card = await createBoardCard()
			await provider.boardStore.updateTask(card.id, { stage: "approved" })
			await provider.boardStore.setColumnMode(card.workspaceId, "backlog", "architect")
			const createTask = vi.spyOn(provider, "createTask").mockResolvedValue({ taskId: "execution-mode" } as any)

			await provider.startBoardTask(card.id)

			expect(createTask).toHaveBeenCalledWith("Board task", undefined, undefined, {}, {})
		})

		it("carries the refined description into the execution task", async () => {
			const card = await createBoardCard("Add a dark mode toggle")
			await provider.boardStore.linkRefinementTask(card.id, "refine-1")
			await provider.boardStore.updateTask(card.id, {
				description: "Add a toggle to the settings panel.\n\nDone when: the theme persists across reloads.",
			})
			const createTask = vi.spyOn(provider, "createTask").mockResolvedValue({ taskId: "execution-1" } as any)

			await provider.startBoardTask(card.id)

			const prompt = createTask.mock.calls[0]![0] as string
			expect(prompt).toContain("Add a dark mode toggle")
			expect(prompt).toContain("Add a toggle to the settings panel.")
			expect(prompt).toContain("Done when: the theme persists across reloads.")
			expect(prompt).toMatch(/agreed while refining/i)
		})

		it("starts an unrefined card from its title alone", async () => {
			const card = await createBoardCard("Quick fix")
			const createTask = vi.spyOn(provider, "createTask").mockResolvedValue({ taskId: "execution-1" } as any)

			await provider.startBoardTask(card.id)

			expect(createTask.mock.calls[0]![0]).toBe("Quick fix")
		})

		it("passes a hand-written description without claiming it was refined", async () => {
			const card = await createBoardCard("Hand written")
			await provider.boardStore.updateTask(card.id, { description: "Some notes I typed myself." })
			const createTask = vi.spyOn(provider, "createTask").mockResolvedValue({ taskId: "execution-1" } as any)

			await provider.startBoardTask(card.id)

			const prompt = createTask.mock.calls[0]![0] as string
			expect(prompt).toContain("Some notes I typed myself.")
			expect(prompt).not.toMatch(/agreed while refining/i)
		})

		it("moves only the card linked to a completed execution task", async () => {
			const firstCard = await createBoardCard("First")
			const workspaceId = firstCard.workspaceId
			await provider.boardStore.createTask({ workspaceId, title: "Second" })
			const secondCard = provider.boardStore.getSnapshot().tasks[1]!
			await provider.boardStore.linkTaskToHistory(firstCard.id, "execution-1")
			await provider.boardStore.linkTaskToHistory(secondCard.id, "execution-2")

			const fakeTask = makeFakeTask("execution-1")
			;(provider as any).taskCreationCallback(fakeTask)
			await fakeTask.emit(RooCodeEventName.TaskCompleted, "execution-1", {}, {})

			const cards = provider.boardStore.getSnapshot().tasks
			expect(cards.find((card) => card.id === firstCard.id)?.stage).toBe("qa_validation")
			// Linking moves a card to in progress; only the completed one advances.
			expect(cards.find((card) => card.id === secondCard.id)?.stage).toBe("in_progress")
		})

		it("moves a started card into the in progress column", async () => {
			const card = await createBoardCard()
			vi.spyOn(provider, "createTask").mockResolvedValue({ taskId: "execution-1" } as any)

			await provider.startBoardTask(card.id)

			expect(provider.boardStore.getSnapshot().tasks[0]).toMatchObject({
				stage: "in_progress",
				linkedHistoryTaskId: "execution-1",
			})
		})
	})

	describe("board task refinement", () => {
		async function createBoardCard(title = "Board task") {
			await provider.boardStore.createWorkspace("Planning")
			const workspaceId = provider.boardStore.getSnapshot().selectedWorkspaceId!
			await provider.boardStore.createTask({ workspaceId, title })
			return provider.boardStore.getSnapshot().tasks[0]!
		}

		it("refines a card in the mode assigned to its column", async () => {
			const card = await createBoardCard()
			await provider.boardStore.setColumnMode(card.workspaceId, "backlog", "architect")
			const createTask = vi.spyOn(provider, "createTask").mockResolvedValue({ taskId: "refine-1" } as any)

			await provider.refineBoardTask(card.id)

			expect(createTask.mock.calls[0]![3]).toEqual({ initialMode: "architect" })
		})

		it("creates a refinement chat in board-refine mode seeded with the card", async () => {
			const card = await createBoardCard("Add dark mode")
			await provider.boardStore.updateTask(card.id, { description: "Follow the VS Code theme" })
			const createTask = vi.spyOn(provider, "createTask").mockResolvedValue({ taskId: "refine-1" } as any)

			await provider.refineBoardTask(card.id)

			expect(createTask).toHaveBeenCalledTimes(1)
			const [prompt, images, parent, options] = createTask.mock.calls[0]!
			expect(options).toEqual({ initialMode: "board-refine" })
			expect(images).toBeUndefined()
			expect(parent).toBeUndefined()
			// The card id is what lets update_board_task target the right card, and the
			// description is dropped by the execution path but must reach the refiner.
			expect(prompt).toContain(card.id)
			expect(prompt).toContain("Add dark mode")
			expect(prompt).toContain("Follow the VS Code theme")
			expect(provider.boardStore.getSnapshot().tasks[0]?.linkedRefinementTaskId).toBe("refine-1")
		})

		it("tells the refiner to investigate the codebase before asking questions", async () => {
			const card = await createBoardCard()
			const createTask = vi.spyOn(provider, "createTask").mockResolvedValue({ taskId: "refine-1" } as any)

			await provider.refineBoardTask(card.id)

			const prompt = createTask.mock.calls[0]![0] as string
			expect(prompt).toMatch(/investigate the codebase first/i)
			expect(prompt).toMatch(/prior art/i)
			// It must not start editing or scope the card before we have agreed.
			expect(prompt).toMatch(/do not write or edit product code or tests/i)
			expect(prompt).toMatch(/do not call `update_board_task` yet/i)
		})

		it("gives the refiner the card's workspace and execution mode as context", async () => {
			await provider.boardStore.createWorkspace("Planning", "/repo/zoo")
			const workspaceId = provider.boardStore.getSnapshot().selectedWorkspaceId!
			await provider.boardStore.createTask({ workspaceId, title: "Board task" })
			// Execution runs out of the approved column, so that is the mode a card will run in.
			await provider.boardStore.setColumnMode(workspaceId, "approved", "code")
			const card = provider.boardStore.getSnapshot().tasks[0]!
			const createTask = vi.spyOn(provider, "createTask").mockResolvedValue({ taskId: "refine-1" } as any)

			await provider.refineBoardTask(card.id)

			const prompt = createTask.mock.calls[0]![0] as string
			expect(prompt).toContain("Planning")
			expect(prompt).toContain("/repo/zoo")
			expect(prompt).toContain("code")
		})

		it("marks an empty description rather than leaving the refiner a blank field", async () => {
			const card = await createBoardCard()
			const createTask = vi.spyOn(provider, "createTask").mockResolvedValue({ taskId: "refine-1" } as any)

			await provider.refineBoardTask(card.id)

			expect(createTask.mock.calls[0]![0] as string).toContain("only a title so far")
		})

		it("reopens the existing refinement chat instead of creating a second one", async () => {
			const card = await createBoardCard()
			const createTask = vi.spyOn(provider, "createTask").mockResolvedValue({ taskId: "refine-1" } as any)
			await provider.refineBoardTask(card.id)
			createTask.mockClear()
			const showTaskWithId = vi.spyOn(provider, "showTaskWithId").mockResolvedValue(undefined as any)

			await provider.refineBoardTask(card.id)

			expect(createTask).not.toHaveBeenCalled()
			expect(showTaskWithId).toHaveBeenCalledWith("refine-1")
		})

		it("creates exactly one refinement chat for concurrent clicks", async () => {
			const card = await createBoardCard()
			let releaseCreate!: () => void
			const createStarted = new Promise<void>((resolve) => {
				releaseCreate = resolve
			})
			const createTask = vi.spyOn(provider, "createTask").mockImplementation(
				async () =>
					await new Promise<any>((resolve) => {
						void createStarted.then(() => resolve({ taskId: "refine-1" }))
					}),
			)

			const first = provider.refineBoardTask(card.id)
			const second = provider.refineBoardTask(card.id)
			// createTask stays blocked until releaseCreate, so this only has to outlast
			// the claim being taken - not a particular number of microtasks.
			await new Promise((resolve) => setTimeout(resolve, 0))
			expect(createTask).toHaveBeenCalledTimes(1)
			releaseCreate()
			await Promise.all([first, second])

			expect(provider.boardStore.getSnapshot().tasks[0]?.linkedRefinementTaskId).toBe("refine-1")
		})

		it("refuses to refine a card with no title", async () => {
			await provider.boardStore.createWorkspace("Planning")
			const workspaceId = provider.boardStore.getSnapshot().selectedWorkspaceId!
			await provider.boardStore.createTask({ workspaceId })
			const card = provider.boardStore.getSnapshot().tasks[0]!

			await expect(provider.refineBoardTask(card.id)).rejects.toThrow(/needs a title/)
		})

		it("tells the refiner its acceptance criteria will be validated later", async () => {
			const card = await createBoardCard()
			const createTask = vi.spyOn(provider, "createTask").mockResolvedValue({ taskId: "refine-1" } as any)

			await provider.refineBoardTask(card.id)

			expect(createTask.mock.calls[0]![0] as string).toMatch(/QA validation run will later check/i)
		})
	})

	describe("board task validation", () => {
		async function createImplementedCard(title = "Board task") {
			await provider.boardStore.createWorkspace("Planning")
			const workspaceId = provider.boardStore.getSnapshot().selectedWorkspaceId!
			await provider.boardStore.createTask({ workspaceId, title, stage: "approved" })
			const cardId = provider.boardStore.getSnapshot().tasks[0]!.id
			await provider.boardStore.linkTaskToHistory(cardId, "execution-1")
			await provider.boardStore.moveLinkedHistoryTaskToQaValidation("execution-1")
			return provider.boardStore.getSnapshot().tasks[0]!
		}

		it("creates a validation chat in board-qa mode seeded with the card's criteria", async () => {
			const card = await createImplementedCard("Add dark mode")
			await provider.boardStore.updateTask(card.id, {
				description: "Done when: the theme persists across reloads.",
			})
			const createTask = vi.spyOn(provider, "createTask").mockResolvedValue({ taskId: "validate-1" } as any)

			await provider.validateBoardTask(card.id)

			expect(createTask).toHaveBeenCalledTimes(1)
			const [prompt, images, parent, options] = createTask.mock.calls[0]!
			expect(options).toEqual({ initialMode: "board-qa" })
			expect(images).toBeUndefined()
			expect(parent).toBeUndefined()
			// The card id is what lets update_board_task target the right card, and the
			// criteria plus the run that implemented them are what there is to check.
			expect(prompt).toContain(card.id)
			expect(prompt).toContain("Add dark mode")
			expect(prompt).toContain("Done when: the theme persists across reloads.")
			expect(prompt).toContain("execution-1")
			expect(provider.boardStore.getSnapshot().tasks[0]).toMatchObject({
				stage: "qa_validation",
				linkedValidationTaskId: "validate-1",
			})
		})

		it("tells the validator to verify the code itself and not to fix it", async () => {
			const card = await createImplementedCard()
			const createTask = vi.spyOn(provider, "createTask").mockResolvedValue({ taskId: "validate-1" } as any)

			await provider.validateBoardTask(card.id)

			const prompt = createTask.mock.calls[0]![0] as string
			expect(prompt).toMatch(/not against a summary/i)
			expect(prompt).toMatch(/do not write or edit product code or tests/i)
			// A failing validation has to keep the card out of done by itself.
			expect(prompt).toMatch(/set `stage` to `"in_progress"`/i)
		})

		it("validates a card in the mode assigned to its column", async () => {
			const card = await createImplementedCard()
			await provider.boardStore.setColumnMode(card.workspaceId, "qa_validation", "debug")
			const createTask = vi.spyOn(provider, "createTask").mockResolvedValue({ taskId: "validate-1" } as any)

			await provider.validateBoardTask(card.id)

			expect(createTask.mock.calls[0]![3]).toEqual({ initialMode: "debug" })
		})

		it("marks an unscoped card rather than leaving the validator no criteria", async () => {
			const card = await createImplementedCard()
			const createTask = vi.spyOn(provider, "createTask").mockResolvedValue({ taskId: "validate-1" } as any)

			await provider.validateBoardTask(card.id)

			expect(createTask.mock.calls[0]![0] as string).toContain("never scoped")
		})

		it("reopens the existing validation chat instead of creating a second one", async () => {
			const card = await createImplementedCard()
			const createTask = vi.spyOn(provider, "createTask").mockResolvedValue({ taskId: "validate-1" } as any)
			await provider.validateBoardTask(card.id)
			await provider.updateTaskHistory(createHistoryItem({ id: "validate-1", task: "Validate" }))
			createTask.mockClear()
			const showTaskWithId = vi.spyOn(provider, "showTaskWithId").mockResolvedValue(undefined as any)

			await provider.validateBoardTask(card.id)

			expect(createTask).not.toHaveBeenCalled()
			expect(showTaskWithId).toHaveBeenCalledWith("validate-1")
		})

		// A validation run that never wrote any messages leaves nothing in history, so
		// reopening it can only fail — the card must not be left with a dead button.
		it("starts a fresh validation run when the linked chat is gone from history", async () => {
			const card = await createImplementedCard()
			const createTask = vi
				.spyOn(provider, "createTask")
				.mockResolvedValueOnce({ taskId: "validate-gone" } as any)
				.mockResolvedValueOnce({ taskId: "validate-2" } as any)
			await provider.validateBoardTask(card.id)
			const showTaskWithId = vi.spyOn(provider, "showTaskWithId").mockResolvedValue(undefined as any)

			await provider.validateBoardTask(card.id)

			expect(showTaskWithId).not.toHaveBeenCalled()
			expect(createTask).toHaveBeenCalledTimes(2)
			expect(provider.boardStore.getSnapshot().tasks[0]).toMatchObject({
				stage: "qa_validation",
				linkedValidationTaskId: "validate-2",
			})
		})

		it("creates exactly one validation chat for concurrent clicks", async () => {
			const card = await createImplementedCard()
			let releaseCreate!: () => void
			const createStarted = new Promise<void>((resolve) => {
				releaseCreate = resolve
			})
			const createTask = vi.spyOn(provider, "createTask").mockImplementation(
				async () =>
					await new Promise<any>((resolve) => {
						void createStarted.then(() => resolve({ taskId: "validate-1" }))
					}),
			)

			const first = provider.validateBoardTask(card.id)
			const second = provider.validateBoardTask(card.id)
			// createTask stays blocked until releaseCreate, so this only has to outlast
			// the claim being taken - not a particular number of microtasks.
			await new Promise((resolve) => setTimeout(resolve, 0))
			expect(createTask).toHaveBeenCalledTimes(1)
			releaseCreate()
			await Promise.all([first, second])

			expect(provider.boardStore.getSnapshot().tasks[0]?.linkedValidationTaskId).toBe("validate-1")
		})

		it("leaves the card unlinked when validation task creation fails", async () => {
			const card = await createImplementedCard()
			vi.spyOn(provider, "createTask").mockRejectedValueOnce(new Error("creation failed"))

			await expect(provider.validateBoardTask(card.id)).rejects.toThrow("creation failed")
			expect(provider.boardStore.getSnapshot().tasks[0]?.linkedValidationTaskId).toBeUndefined()
		})

		it("refuses to validate a card with no title", async () => {
			await provider.boardStore.createWorkspace("Planning")
			const workspaceId = provider.boardStore.getSnapshot().selectedWorkspaceId!
			await provider.boardStore.createTask({ workspaceId, stage: "qa_validation" })
			const card = provider.boardStore.getSnapshot().tasks[0]!

			await expect(provider.validateBoardTask(card.id)).rejects.toThrow(/needs a title/)
		})

		it("validates a card dragged into the column without an execution run", async () => {
			await provider.boardStore.createWorkspace("Planning")
			const workspaceId = provider.boardStore.getSnapshot().selectedWorkspaceId!
			await provider.boardStore.createTask({ workspaceId, title: "Hand moved", stage: "qa_validation" })
			const card = provider.boardStore.getSnapshot().tasks[0]!
			const createTask = vi.spyOn(provider, "createTask").mockResolvedValue({ taskId: "validate-1" } as any)

			await provider.validateBoardTask(card.id)

			expect(createTask.mock.calls[0]![0] as string).toContain("no execution run")
		})
	})

	describe("board task stop and approve", () => {
		async function createStartedCard() {
			await provider.boardStore.createWorkspace("Planning")
			const workspaceId = provider.boardStore.getSnapshot().selectedWorkspaceId!
			await provider.boardStore.createTask({ workspaceId, title: "Board task", stage: "approved" })
			const card = provider.boardStore.getSnapshot().tasks[0]!
			await provider.boardStore.linkTaskToHistory(card.id, "execution-1")
			return card
		}

		it("cancels the running execution task and returns the card to approved", async () => {
			const card = await createStartedCard()
			vi.spyOn((provider as any).taskRegistry, "hasRunning").mockReturnValue(true)
			vi.spyOn(provider, "getCurrentTask").mockReturnValue({ taskId: "execution-1" } as any)
			const cancelTask = vi.spyOn(provider, "cancelTask").mockResolvedValue(undefined)

			await provider.stopBoardTask(card.id)

			expect(cancelTask).toHaveBeenCalledTimes(1)
			expect(provider.boardStore.getSnapshot().tasks[0]).toMatchObject({ stage: "approved" })
			expect(provider.boardStore.getSnapshot().tasks[0]?.linkedHistoryTaskId).toBeUndefined()
		})

		it("focuses the linked task before cancelling when another task is current", async () => {
			const card = await createStartedCard()
			vi.spyOn((provider as any).taskRegistry, "hasRunning").mockReturnValue(true)
			vi.spyOn(provider, "getCurrentTask").mockReturnValue({ taskId: "other-task" } as any)
			const setCurrent = vi.spyOn((provider as any).taskRegistry, "setCurrent").mockReturnValue(undefined)
			const cancelTask = vi.spyOn(provider, "cancelTask").mockResolvedValue(undefined)

			await provider.stopBoardTask(card.id)

			expect(setCurrent).toHaveBeenCalledWith("execution-1")
			expect(cancelTask).toHaveBeenCalledTimes(1)
		})

		it("reports whether the card's execution run is still live, so the board can pick Stop or Start", async () => {
			await createStartedCard()
			const run = { taskId: "execution-1", abort: false, abandoned: false }
			;(provider as any).taskRegistry.push(run)

			expect((await provider.getStateToPostToWebview()).runningTaskIds).toContain("execution-1")

			// What the board has to notice: the run ends but the card stays put, so a card
			// still offering Stop would be offering to cancel nothing.
			run.abort = true

			expect((await provider.getStateToPostToWebview()).runningTaskIds).not.toContain("execution-1")
		})

		it("stops reporting a run that was cancelled from the chat view", async () => {
			await createStartedCard()
			// Cancelling rehydrates the task, so it is resident again and only the ask it
			// is parked on says it has stopped. A card reading residency would go on
			// offering to stop a run that is already over.
			const run = { taskId: "execution-1", abort: false, abandoned: false, resumableAsk: undefined as any }
			;(provider as any).taskRegistry.push(run)

			expect((await provider.getStateToPostToWebview()).runningTaskIds).toContain("execution-1")

			run.resumableAsk = { type: "ask", ask: "resume_task", ts: 1 }

			expect((await provider.getStateToPostToWebview()).runningTaskIds).not.toContain("execution-1")
		})

		it("stops reporting a run parked on the result it signed off with", async () => {
			await createStartedCard()
			const run = { taskId: "execution-1", abort: false, abandoned: false, idleAsk: undefined as any }
			;(provider as any).taskRegistry.push(run)
			run.idleAsk = { type: "ask", ask: "completion_result", ts: 1 }

			expect((await provider.getStateToPostToWebview()).runningTaskIds).not.toContain("execution-1")
		})

		it("reports a run that has stopped to ask the user something", async () => {
			await createStartedCard()
			const run = { taskId: "execution-1", abort: false, abandoned: false, interactiveAsk: undefined as any }
			;(provider as any).taskRegistry.push(run)

			// Working: nothing is being waited on that the user could answer.
			expect((await provider.getStateToPostToWebview()).awaitingTaskIds).not.toContain("execution-1")

			// A tool or command approval, or a follow-up question. The run stays live, so
			// the board would otherwise show a card that looks busy but cannot progress.
			run.interactiveAsk = { type: "ask", ask: "use_mcp_server", ts: 1 }

			const state = await provider.getStateToPostToWebview()
			expect(state.awaitingTaskIds).toContain("execution-1")
			expect(state.runningTaskIds).toContain("execution-1")
		})

		it("still resets the card when the execution task is no longer running", async () => {
			const card = await createStartedCard()
			vi.spyOn((provider as any).taskRegistry, "hasRunning").mockReturnValue(false)
			const cancelTask = vi.spyOn(provider, "cancelTask").mockResolvedValue(undefined)

			await provider.stopBoardTask(card.id)

			expect(cancelTask).not.toHaveBeenCalled()
			expect(provider.boardStore.getSnapshot().tasks[0]).toMatchObject({ stage: "approved" })
		})

		it("cancels a card's refinement run without dropping the conversation", async () => {
			await provider.boardStore.createWorkspace("Planning")
			const workspaceId = provider.boardStore.getSnapshot().selectedWorkspaceId!
			await provider.boardStore.createTask({ workspaceId, title: "Board task", stage: "backlog" })
			const card = provider.boardStore.getSnapshot().tasks[0]!
			await provider.boardStore.linkRefinementTask(card.id, "stop-refine-1")
			vi.spyOn((provider as any).taskRegistry, "hasRunning").mockReturnValue(true)
			vi.spyOn(provider, "getCurrentTask").mockReturnValue({ taskId: "stop-refine-1" } as any)
			const cancelTask = vi.spyOn(provider, "cancelTask").mockResolvedValue(undefined)

			await provider.stopBoardRefinement(card.id)

			expect(cancelTask).toHaveBeenCalledTimes(1)
			// Refinement is a discussion with the user, so what was said before the run was
			// called off is kept - pressing Refine again returns to the same chat.
			expect(provider.boardStore.getSnapshot().tasks[0]).toMatchObject({
				stage: "backlog",
				linkedRefinementTaskId: "stop-refine-1",
			})
		})

		/**
		 * A card being checked. The run ids are per-test because
		 * `ClineProvider.activeInstances` outlives a test: a test that expects to find
		 * nothing running would otherwise match a previous test's registry entry.
		 */
		async function createValidatingCard(executionTaskId: string, validationTaskId: string) {
			await provider.boardStore.createWorkspace("Planning")
			const workspaceId = provider.boardStore.getSnapshot().selectedWorkspaceId!
			await provider.boardStore.createTask({ workspaceId, title: "Board task", stage: "approved" })
			const cardId = provider.boardStore.getSnapshot().tasks[0]!.id
			await provider.boardStore.linkTaskToHistory(cardId, executionTaskId)
			await provider.boardStore.moveLinkedHistoryTaskToQaValidation(executionTaskId)
			await provider.boardStore.linkValidationTask(cardId, validationTaskId)
			return provider.boardStore.getSnapshot().tasks[0]!
		}

		it("cancels the running validation task and leaves the card in qa validation", async () => {
			const card = await createValidatingCard("stop-execution-1", "stop-validate-1")
			vi.spyOn((provider as any).taskRegistry, "hasRunning").mockReturnValue(true)
			vi.spyOn(provider, "getCurrentTask").mockReturnValue({ taskId: "stop-validate-1" } as any)
			const cancelTask = vi.spyOn(provider, "cancelTask").mockResolvedValue(undefined)

			await provider.stopBoardValidation(card.id)

			expect(cancelTask).toHaveBeenCalledTimes(1)
			// The implementation is untouched by a cancelled check, so the card stays where
			// it is - only the half-finished check is dropped, so Validate starts a new one.
			expect(provider.boardStore.getSnapshot().tasks[0]).toMatchObject({
				stage: "qa_validation",
				linkedHistoryTaskId: "stop-execution-1",
			})
			expect(provider.boardStore.getSnapshot().tasks[0]?.linkedValidationTaskId).toBeUndefined()
		})

		it("focuses the validation task before cancelling when another task is current", async () => {
			const card = await createValidatingCard("stop-execution-2", "stop-validate-2")
			vi.spyOn((provider as any).taskRegistry, "hasRunning").mockReturnValue(true)
			vi.spyOn(provider, "getCurrentTask").mockReturnValue({ taskId: "other-task" } as any)
			const setCurrent = vi.spyOn((provider as any).taskRegistry, "setCurrent").mockReturnValue(undefined)
			const cancelTask = vi.spyOn(provider, "cancelTask").mockResolvedValue(undefined)

			await provider.stopBoardValidation(card.id)

			expect(setCurrent).toHaveBeenCalledWith("stop-validate-2")
			expect(cancelTask).toHaveBeenCalledTimes(1)
		})

		it("still drops the validation link when the validation task is no longer running", async () => {
			// The window was reloaded out from under the check: the card is still linked to
			// a conversation nobody is hosting, and pressing Stop has to clear it anyway.
			const card = await createValidatingCard("stop-execution-3", "stop-validate-3")
			// Earlier tests' providers linger in `activeInstances` with their registries
			// stubbed to claim every run, so this is the only way to say "nothing is running".
			vi.spyOn(ClineProvider, "getAllInstances").mockReturnValue([provider])
			const cancelTask = vi.spyOn(provider, "cancelTask").mockResolvedValue(undefined)

			await provider.stopBoardValidation(card.id)

			expect(cancelTask).not.toHaveBeenCalled()
			expect(provider.boardStore.getSnapshot().tasks[0]?.linkedValidationTaskId).toBeUndefined()
		})

		it("resumes a card's parked run by telling it what to do next", async () => {
			const card = await createStartedCard()
			// A run that has called attempt_completion is still resident: it holds its
			// result open rather than ending, which is exactly the state a card returned
			// by validation finds its run in.
			const run = {
				taskId: "execution-1",
				abort: false,
				abandoned: false,
				idleAsk: { ts: 1 },
				resumableAsk: undefined,
				handleWebviewAskResponse: vi.fn(function (this: any) {
					this.idleAsk = undefined
				}),
			}
			;(provider as any).taskRegistry.push(run)
			vi.spyOn(provider, "getCurrentTask").mockReturnValue(run as any)

			await provider.resumeBoardTask(card.id, "Fix the found issues")

			expect(run.handleWebviewAskResponse).toHaveBeenCalledWith("messageResponse", "Fix the found issues")
		})

		it("reads a validation run's verdict off its live conversation", async () => {
			await createStartedCard()
			// A run parked on its completion holds messages its last save may not have
			// reached, so the resident copy is the one that has to be read.
			;(provider as any).taskRegistry.push({
				taskId: "validate-1",
				abort: false,
				abandoned: false,
				clineMessages: [
					{ type: "say", say: "text", text: "Checking the criteria...", ts: 1 },
					{ type: "say", say: "completion_result", text: "Criterion 2 not met: parser.ts:88.", ts: 2 },
				],
			})

			await expect((provider as any).readBoardCompletionMessage("validate-1")).resolves.toBe(
				"Criterion 2 not met: parser.ts:88.",
			)
		})

		it("takes the most recent verdict when a run has signed off more than once", async () => {
			await createStartedCard()
			;(provider as any).taskRegistry.push({
				taskId: "validate-twice",
				abort: false,
				abandoned: false,
				clineMessages: [
					{ type: "say", say: "completion_result", text: "First pass: two criteria unmet.", ts: 1 },
					{ type: "say", say: "completion_result", text: "Second pass: one criterion unmet.", ts: 2 },
				],
			})

			await expect((provider as any).readBoardCompletionMessage("validate-twice")).resolves.toBe(
				"Second pass: one criterion unmet.",
			)
		})

		it("reports no verdict for a run that never signed off", async () => {
			await createStartedCard()
			;(provider as any).taskRegistry.push({
				taskId: "validate-unfinished",
				abort: false,
				abandoned: false,
				clineMessages: [{ type: "say", say: "text", text: "Still checking", ts: 1 }],
			})

			await expect((provider as any).readBoardCompletionMessage("validate-unfinished")).resolves.toBeUndefined()
		})

		it("refuses to resume a card that was never started", async () => {
			await provider.boardStore.createWorkspace("Planning")
			const workspaceId = provider.boardStore.getSnapshot().selectedWorkspaceId!
			await provider.boardStore.createTask({ workspaceId, title: "Board task", stage: "approved" })
			const card = provider.boardStore.getSnapshot().tasks[0]!

			await expect(provider.resumeBoardTask(card.id, "Carry on")).rejects.toThrow("no execution run")
		})

		it("moves an in-progress card to qa validation when its execution task reports completion", async () => {
			const card = await createStartedCard()
			expect(provider.boardStore.getSnapshot().tasks[0]).toMatchObject({ stage: "in_progress" })

			await provider.markBoardTaskCompleted("execution-1")

			expect(provider.boardStore.getSnapshot().tasks[0]).toMatchObject({
				stage: "qa_validation",
				linkedHistoryTaskId: "execution-1",
			})
			expect(card.id).toBe(provider.boardStore.getSnapshot().tasks[0]?.id)
		})

		it("retires a card to done when its validation task reports completion", async () => {
			const card = await createStartedCard()
			await provider.boardStore.linkValidationTask(card.id, "validate-1")

			await provider.markBoardTaskCompleted("validate-1")

			expect(provider.boardStore.getSnapshot().tasks[0]).toMatchObject({
				stage: "done",
				linkedValidationTaskId: "validate-1",
			})
		})

		it("keeps a card out of done when its validator sent it back before completing", async () => {
			const card = await createStartedCard()
			await provider.boardStore.linkValidationTask(card.id, "validate-1")
			// The validator wrote its findings onto the card and returned it for more work.
			await provider.boardStore.updateTask(card.id, { stage: "in_progress" })

			await provider.markBoardTaskCompleted("validate-1")

			expect(provider.boardStore.getSnapshot().tasks[0]).toMatchObject({ stage: "in_progress" })
		})

		/**
		 * A run parked on the verdict it signed off with. `ClineProvider.activeInstances`
		 * outlives a test, so every run here is named distinctly — reusing an id would
		 * find a previous test's registry entry instead of this one.
		 */
		const signOff = (taskId: string, text: string) =>
			(provider as any).taskRegistry.push({
				taskId,
				abort: false,
				abandoned: false,
				clineMessages: [{ type: "say", say: "completion_result", text, ts: 1 }],
			})

		/** A run that has stopped and is parked waiting to be told what to do next. */
		const parkedRun = (taskId: string) => {
			const run = {
				taskId,
				abort: false,
				abandoned: false,
				idleAsk: { ts: 1 },
				resumableAsk: undefined,
				clineMessages: [],
				handleWebviewAskResponse: vi.fn(function (this: any) {
					this.idleAsk = undefined
				}),
			}
			;(provider as any).taskRegistry.push(run)
			vi.spyOn(provider, "getCurrentTask").mockReturnValue(run as any)
			return run
		}

		it("tells a card's parked run to carry on rather than only reopening it", async () => {
			await provider.boardStore.createWorkspace("Planning")
			const workspaceId = provider.boardStore.getSnapshot().selectedWorkspaceId!
			await provider.boardStore.createTask({ workspaceId, title: "Board task", stage: "approved" })
			const card = provider.boardStore.getSnapshot().tasks[0]!
			await provider.boardStore.linkTaskToHistory(card.id, "execution-parked")
			const run = parkedRun("execution-parked")

			await provider.startBoardTask(card.id)

			// Reopening a conversation does not make it do anything, so a card whose run
			// died would otherwise offer a button that appears to do nothing.
			expect(run.handleWebviewAskResponse).toHaveBeenCalledWith(
				"messageResponse",
				expect.stringContaining("Continue this task"),
			)
		})

		it("does not start a second run for a card that already has one", async () => {
			await provider.boardStore.createWorkspace("Planning")
			const workspaceId = provider.boardStore.getSnapshot().selectedWorkspaceId!
			await provider.boardStore.createTask({ workspaceId, title: "Board task", stage: "approved" })
			const card = provider.boardStore.getSnapshot().tasks[0]!
			await provider.boardStore.linkTaskToHistory(card.id, "execution-kept")
			parkedRun("execution-kept")
			const createTask = vi.spyOn(provider, "createTask")

			await provider.startBoardTask(card.id)

			expect(createTask).not.toHaveBeenCalled()
			// Picked back up, so the card belongs in the column that says work is happening.
			expect(provider.boardStore.getSnapshot().tasks[0]).toMatchObject({
				stage: "in_progress",
				linkedHistoryTaskId: "execution-kept",
			})
		})

		it("hands a card validation sent back the validator's verdict when started by hand", async () => {
			await provider.boardStore.createWorkspace("Planning")
			const workspaceId = provider.boardStore.getSnapshot().selectedWorkspaceId!
			await provider.boardStore.createTask({ workspaceId, title: "Board task", stage: "approved" })
			const card = provider.boardStore.getSnapshot().tasks[0]!
			await provider.boardStore.linkTaskToHistory(card.id, "execution-sent-back")
			await provider.boardStore.linkValidationTask(card.id, "validate-sent-back")
			// The validator wrote its findings onto the card and returned it for more work.
			await provider.boardStore.updateTask(card.id, { stage: "in_progress" })
			signOff("validate-sent-back", "BLOCKED — criterion 2 unmet: parser.ts:88 is never reached.")
			const run = parkedRun("execution-sent-back")

			await provider.startBoardTask(card.id)

			expect(run.handleWebviewAskResponse).toHaveBeenCalledWith(
				"messageResponse",
				expect.stringContaining("parser.ts:88"),
			)
		})

		it("leaves a live run alone rather than interrupting it", async () => {
			await provider.boardStore.createWorkspace("Planning")
			const workspaceId = provider.boardStore.getSnapshot().selectedWorkspaceId!
			await provider.boardStore.createTask({ workspaceId, title: "Board task", stage: "approved" })
			const card = provider.boardStore.getSnapshot().tasks[0]!
			await provider.boardStore.linkTaskToHistory(card.id, "execution-live")
			const run = { taskId: "execution-live", abort: false, abandoned: false, handleWebviewAskResponse: vi.fn() }
			;(provider as any).taskRegistry.push(run)

			await provider.startBoardTask(card.id)

			// Start is not a way to interrupt work that is already going.
			expect(run.handleWebviewAskResponse).not.toHaveBeenCalled()
		})

		it("keeps a card in progress when its execution run reported BLOCKED", async () => {
			await provider.boardStore.createWorkspace("Planning")
			const workspaceId = provider.boardStore.getSnapshot().selectedWorkspaceId!
			await provider.boardStore.createTask({ workspaceId, title: "Board task", stage: "approved" })
			const card = provider.boardStore.getSnapshot().tasks[0]!
			await provider.boardStore.linkTaskToHistory(card.id, "execution-blocked")
			signOff("execution-blocked", "BLOCKED — the approved plan needs a schema change I cannot make here.")

			await provider.markBoardTaskCompleted("execution-blocked")

			// Handing this to a validator would spend a run rediscovering what the
			// implementer already said, and the card would come straight back.
			expect(provider.boardStore.getSnapshot().tasks[0]).toMatchObject({ stage: "in_progress" })
		})

		it("sends a card back when its validator reported BLOCKED without moving it", async () => {
			const card = await createStartedCard()
			await provider.boardStore.linkValidationTask(card.id, "validate-blocked")
			// A validation mode written to report a verdict rather than to move the card.
			signOff("validate-blocked", "BLOCKED\n\nPRODUCT DEFECT: the delete flow never confirms.")

			await provider.markBoardTaskCompleted("validate-blocked")

			// Retiring a card its own validator just failed is the one outcome that must
			// never happen, whatever mode the column is pointed at.
			expect(provider.boardStore.getSnapshot().tasks[0]).toMatchObject({ stage: "in_progress" })
		})

		it("still retires a card whose validator signed off PASSED", async () => {
			const card = await createStartedCard()
			await provider.boardStore.linkValidationTask(card.id, "validate-passed")
			signOff("validate-passed", "PASSED — every criterion is met.")

			await provider.markBoardTaskCompleted("validate-passed")

			expect(provider.boardStore.getSnapshot().tasks[0]).toMatchObject({ stage: "done" })
		})

		it("ignores completion of a task that is not an execution run for any card", async () => {
			await createStartedCard()
			const cardId = provider.boardStore.getSnapshot().tasks[0]!.id
			await provider.boardStore.linkRefinementTask(cardId, "refine-1")

			// A refinement chat completing must not retire the card it was planning, and
			// this card is already past backlog so it must not be dragged back either.
			await provider.markBoardTaskCompleted("refine-1")
			await provider.markBoardTaskCompleted("some-unrelated-task")

			expect(provider.boardStore.getSnapshot().tasks[0]).toMatchObject({ stage: "in_progress" })
		})

		it("moves a refined backlog card to scoped when its refinement chat completes", async () => {
			await provider.boardStore.createWorkspace("Planning")
			const workspaceId = provider.boardStore.getSnapshot().selectedWorkspaceId!
			await provider.boardStore.createTask({ workspaceId, title: "Add dark mode", stage: "backlog" })
			const cardId = provider.boardStore.getSnapshot().tasks[0]!.id
			await provider.boardStore.linkRefinementTask(cardId, "refine-1")

			await provider.markBoardTaskCompleted("refine-1")

			expect(provider.boardStore.getSnapshot().tasks[0]).toMatchObject({
				stage: "scoped",
				linkedRefinementTaskId: "refine-1",
			})
		})

		it("advances a scoped card to approved", async () => {
			await provider.boardStore.createWorkspace("Planning")
			const workspaceId = provider.boardStore.getSnapshot().selectedWorkspaceId!
			await provider.boardStore.createTask({ workspaceId, title: "Board task", stage: "scoped" })
			const card = provider.boardStore.getSnapshot().tasks[0]!

			await provider.approveBoardTask(card.id)

			expect(provider.boardStore.getSnapshot().tasks[0]).toMatchObject({ stage: "approved" })
		})
	})
})
