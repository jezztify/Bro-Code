// npx vitest run __tests__/single-open-invariant.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"
import { type OutputChannel } from "vscode"
import { ClineProvider } from "../core/webview/ClineProvider"
import { TaskRegistry } from "../core/task/TaskRegistry"
import { TaskScheduler } from "../core/task/TaskScheduler"
import { type Task } from "../core/task/Task"
import { API } from "../extension/api"
import * as ProfileValidatorMod from "../shared/ProfileValidator"

type PrivateClineProviderMethods = {
	createTask: (
		this: unknown,
		text?: string,
		images?: string[],
		parentTask?: Task,
		options?: Parameters<ClineProvider["createTask"]>[3],
	) => ReturnType<ClineProvider["createTask"]>
	createTaskWithHistoryItem: (
		this: unknown,
		...args: Parameters<ClineProvider["createTaskWithHistoryItem"]>
	) => ReturnType<ClineProvider["createTaskWithHistoryItem"]>
	evictCurrentTask: (this: unknown) => ReturnType<ClineProvider["evictCurrentTask"]>
	unfocusCurrentTask: (this: unknown) => ReturnType<ClineProvider["unfocusCurrentTask"]>
}

const privateClineProvider = ClineProvider.prototype as unknown as PrivateClineProviderMethods

// User-initiated creation deliberately bypasses TaskScheduler and calls run()
// directly (see startTaskImmediately in ClineProvider), so "did the task start?"
// is asserted on run() rather than on the scheduler.
const { runSpy } = vi.hoisted(() => ({ runSpy: vi.fn() }))

// Mock Task class used by ClineProvider to avoid heavy startup
vi.mock("../core/task/Task", () => {
	class TaskStub {
		public taskId: string
		public instanceId = "inst"
		public parentTask?: unknown
		public apiConfiguration: unknown
		public rootTask?: unknown
		public taskNumber?: number
		constructor(opts: {
			historyItem?: { id: string }
			parentTask?: unknown
			rootTask?: unknown
			taskNumber?: number
			apiConfiguration?: unknown
			onCreated?: (t: TaskStub) => void
		}) {
			this.taskId = opts.historyItem?.id ?? `task-${Math.random().toString(36).slice(2, 8)}`
			this.parentTask = opts.parentTask
			this.rootTask = opts.rootTask
			this.taskNumber = opts.taskNumber
			this.apiConfiguration = opts.apiConfiguration ?? { apiProvider: "anthropic" }
			opts.onCreated?.(this)
		}
		start() {}
		run() {
			runSpy(this.taskId)
			return Promise.resolve()
		}
		on() {}
		off() {}
		emit() {}
	}
	return { Task: TaskStub }
})

describe("Starting a task alongside one already open", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
		runSpy.mockClear()
	})

	// Regression: board cards (Refine/Approve/Start/Validate) and the New Task button
	// both land in createTask. When these went through TaskScheduler, the first task to
	// park on an `ask` kept the only permit at maxConcurrency=1, so every later create
	// sat in the queue, never reached startTask(), and rendered as a blank chat.
	it("User-initiated create: repeated creates all start, even while a real scheduler permit is held", async () => {
		vi.spyOn(ProfileValidatorMod.ProfileValidator, "isProfileAllowed").mockReturnValue(true)

		const scheduler = new TaskScheduler()
		// Occupy the single permit with work that never settles, standing in for a task
		// waiting on the user.
		void scheduler.schedule(
			{ abort: false, abandoned: false } as unknown as Task,
			() => new Promise<void>(() => {}),
		)
		for (let i = 0; i < 50; i++) await Promise.resolve()

		const registry = new TaskRegistry()
		const provider = {
			taskRegistry: registry,
			taskScheduler: scheduler,
			getCurrentTask: vi.fn(() => registry.current),
			taskHistoryStore: { get: vi.fn(() => undefined) },
			setValues: vi.fn(),
			getState: vi.fn().mockResolvedValue({
				apiConfiguration: { apiProvider: "anthropic", consecutiveMistakeLimit: 0 },
				organizationAllowList: "*",
				enableCheckpoints: true,
				checkpointTimeout: 60,
				cloudUserInfo: null,
			}),
			addClineToStack: vi.fn().mockResolvedValue(undefined),
			setProviderProfile: vi.fn(),
			log: vi.fn(),
			getStateToPostToWebview: vi.fn(),
			providerSettingsManager: { getModeConfigId: vi.fn(), listConfig: vi.fn() },
			customModesManager: { getCustomModes: vi.fn().mockResolvedValue([]) },
			taskCreationCallback: vi.fn(),
			contextProxy: {
				extensionUri: {},
				setValue: vi.fn(),
				getValue: vi.fn(),
				setProviderSettings: vi.fn(),
				getProviderSettings: vi.fn(() => ({})),
			},
		} as unknown as ClineProvider

		for (const label of ["Refine", "Approve", "Validate"]) {
			await privateClineProvider.createTask.call(provider, label)
		}
		for (let i = 0; i < 50; i++) await Promise.resolve()

		// Each card's task must have actually begun; a queued task never calls run().
		expect(runSpy).toHaveBeenCalledTimes(3)
		expect(scheduler.waiting).toBe(0)
	})

	it("User-initiated create: leaves the existing task resident and running", async () => {
		// Allow profile
		vi.spyOn(ProfileValidatorMod.ProfileValidator, "isProfileAllowed").mockReturnValue(true)

		const removeClineFromStack = vi.fn().mockResolvedValue(undefined)
		const addClineToStack = vi.fn().mockResolvedValue(undefined)
		const schedulespy = vi.fn().mockResolvedValue(undefined)

		const existingTask = { taskId: "existing-1", abort: false, abandoned: false }
		const registry = new TaskRegistry()
		registry.push(existingTask as unknown as Task)
		const provider = {
			taskRegistry: registry,
			taskScheduler: { schedule: schedulespy },
			getCurrentTask: vi.fn(() => existingTask),
			taskHistoryStore: { get: vi.fn(() => undefined) },
			markDelegatedChildInterrupted: vi.fn().mockResolvedValue(undefined),
			get evictCurrentTask() {
				return privateClineProvider.evictCurrentTask.bind(this)
			},
			setValues: vi.fn(),
			getState: vi.fn().mockResolvedValue({
				apiConfiguration: { apiProvider: "anthropic", consecutiveMistakeLimit: 0 },
				organizationAllowList: "*",
				enableCheckpoints: true,
				checkpointTimeout: 60,
				cloudUserInfo: null,
			}),
			removeClineFromStack,
			addClineToStack,
			setProviderProfile: vi.fn(),
			log: vi.fn(),
			getStateToPostToWebview: vi.fn(),
			providerSettingsManager: { getModeConfigId: vi.fn(), listConfig: vi.fn() },
			customModesManager: { getCustomModes: vi.fn().mockResolvedValue([]) },
			taskCreationCallback: vi.fn(),
			contextProxy: {
				extensionUri: {},
				setValue: vi.fn(),
				getValue: vi.fn(),
				setProviderSettings: vi.fn(),
				getProviderSettings: vi.fn(() => ({})),
			},
		} as unknown as ClineProvider

		await privateClineProvider.createTask.call(provider, "New task")

		expect(removeClineFromStack).not.toHaveBeenCalled()
		expect(addClineToStack).toHaveBeenCalledTimes(1)
		// Started directly, not queued behind the scheduler's single permit.
		expect(runSpy).toHaveBeenCalledTimes(1)
		expect(schedulespy).not.toHaveBeenCalled()
		// The task that was already open is untouched — not aborted, not evicted.
		expect(registry.getById("existing-1")).toBe(existingTask)
	})

	it("User-initiated create: new top-level task does not inherit lineage from a resident task", async () => {
		vi.spyOn(ProfileValidatorMod.ProfileValidator, "isProfileAllowed").mockReturnValue(true)

		const existingTask = { taskId: "existing-1", abort: false, abandoned: false, taskNumber: 1 }
		const registry = new TaskRegistry()
		registry.push(existingTask as unknown as Task)

		const provider = {
			taskRegistry: registry,
			taskScheduler: new TaskScheduler(),
			getCurrentTask: vi.fn(() => existingTask),
			taskHistoryStore: { get: vi.fn(() => undefined) },
			setValues: vi.fn(),
			getState: vi.fn().mockResolvedValue({
				apiConfiguration: { apiProvider: "anthropic", consecutiveMistakeLimit: 0 },
				organizationAllowList: "*",
				enableCheckpoints: true,
				checkpointTimeout: 60,
				cloudUserInfo: null,
			}),
			addClineToStack: vi.fn().mockResolvedValue(undefined),
			setProviderProfile: vi.fn(),
			log: vi.fn(),
			getStateToPostToWebview: vi.fn(),
			providerSettingsManager: { getModeConfigId: vi.fn(), listConfig: vi.fn() },
			customModesManager: { getCustomModes: vi.fn().mockResolvedValue([]) },
			taskCreationCallback: vi.fn(),
			contextProxy: {
				extensionUri: {},
				setValue: vi.fn(),
				getValue: vi.fn(),
				setProviderSettings: vi.fn(),
				getProviderSettings: vi.fn(() => ({})),
			},
		} as unknown as ClineProvider

		const task = (await privateClineProvider.createTask.call(provider, "New task")) as unknown as {
			rootTask?: unknown
			taskNumber?: number
		}

		expect(task.rootTask).toBeUndefined()
		expect(task.taskNumber).toBe(1)
	})

	it("Subtask create: keeps existing task open and roots itself at the parent", async () => {
		vi.spyOn(ProfileValidatorMod.ProfileValidator, "isProfileAllowed").mockReturnValue(true)

		const removeClineFromStack = vi.fn().mockResolvedValue(undefined)
		const addClineToStack = vi.fn().mockResolvedValue(undefined)
		// A subtask inherits its parent's mode, so createTask asks the parent for it.
		const parentTask = {
			taskId: "parent-1",
			abort: false,
			abandoned: false,
			taskNumber: 1,
			getTaskMode: vi.fn().mockResolvedValue("code"),
		}
		const registry2 = new TaskRegistry()
		registry2.push(parentTask as unknown as Task)

		const provider = {
			taskRegistry: registry2,
			taskScheduler: new TaskScheduler(),
			setValues: vi.fn(),
			getState: vi.fn().mockResolvedValue({
				apiConfiguration: { apiProvider: "anthropic", consecutiveMistakeLimit: 0 },
				organizationAllowList: "*",
				enableCheckpoints: true,
				checkpointTimeout: 60,
				cloudUserInfo: null,
			}),
			removeClineFromStack,
			addClineToStack,
			setProviderProfile: vi.fn(),
			log: vi.fn(),
			getStateToPostToWebview: vi.fn(),
			providerSettingsManager: { getModeConfigId: vi.fn(), listConfig: vi.fn() },
			customModesManager: { getCustomModes: vi.fn().mockResolvedValue([]) },
			taskCreationCallback: vi.fn(),
			contextProxy: {
				extensionUri: {},
				setValue: vi.fn(),
				getValue: vi.fn(),
				setProviderSettings: vi.fn(),
				getProviderSettings: vi.fn(() => ({})),
			},
		} as unknown as ClineProvider

		const task = (await privateClineProvider.createTask.call(
			provider,
			"Subtask",
			undefined,
			parentTask as unknown as Task,
		)) as unknown as { rootTask?: unknown; taskNumber?: number }

		expect(removeClineFromStack).not.toHaveBeenCalled()
		expect(addClineToStack).toHaveBeenCalledTimes(1)
		expect(task.rootTask).toBe(parentTask)
		expect(task.taskNumber).toBe(2)
	})

	it("History resume path always closes current before rehydration (non-rehydrating case)", async () => {
		const removeClineFromStack = vi.fn().mockResolvedValue(undefined)
		const addClineToStack = vi.fn().mockResolvedValue(undefined)
		const updateGlobalState = vi.fn().mockResolvedValue(undefined)
		const schedulespy = vi.fn().mockResolvedValue(undefined)

		const provider = {
			getCurrentTask: vi.fn(() => undefined), // ensure not rehydrating
			taskHistoryStore: { get: vi.fn(() => undefined) },
			markDelegatedChildInterrupted: vi.fn().mockResolvedValue(undefined),
			get evictCurrentTask() {
				return privateClineProvider.evictCurrentTask.bind(this)
			},
			removeClineFromStack,
			addClineToStack,
			updateGlobalState,
			log: vi.fn(),
			customModesManager: { getCustomModes: vi.fn().mockResolvedValue([]) },
			providerSettingsManager: {
				getModeConfigId: vi.fn().mockResolvedValue(undefined),
				listConfig: vi.fn().mockResolvedValue([]),
			},
			getState: vi.fn().mockResolvedValue({
				apiConfiguration: { apiProvider: "anthropic", consecutiveMistakeLimit: 0 },
				enableCheckpoints: true,
				checkpointTimeout: 60,
				experiments: {},
				cloudUserInfo: null,
				taskSyncEnabled: false,
			}),
			// Methods used by createTaskWithHistoryItem for pending edit cleanup
			getPendingEditOperation: vi.fn().mockReturnValue(undefined),
			clearPendingEditOperation: vi.fn(),
			taskScheduler: { schedule: schedulespy },
			context: { extension: { packageJSON: {} }, globalStorageUri: { fsPath: "/tmp" } },
			contextProxy: {
				extensionUri: {},
				getValue: vi.fn(),
				setValue: vi.fn(),
				setProviderSettings: vi.fn(),
				getProviderSettings: vi.fn(() => ({})),
			},
			postStateToWebview: vi.fn(),
		} as unknown as ClineProvider

		const historyItem = {
			id: "hist-1",
			number: 1,
			ts: Date.now(),
			task: "Task",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			workspace: "/tmp",
		}

		const task = await privateClineProvider.createTaskWithHistoryItem.call(provider, historyItem)
		expect(task).toBeTruthy()
		expect(removeClineFromStack).toHaveBeenCalledTimes(1)
		expect(addClineToStack).toHaveBeenCalledTimes(1)
		// run() resumes the history task; start() would not, so this must not regress to start().
		expect(runSpy).toHaveBeenCalledTimes(1)
		expect(schedulespy).not.toHaveBeenCalled()
	})

	it("History resume path starts the task directly in rehydrating (in-place) case", async () => {
		const schedulespy = vi.fn().mockResolvedValue(undefined)
		const removeClineFromStack = vi.fn().mockResolvedValue(undefined)
		const historyId = "hist-rehydrate-1"

		const existingTask = {
			taskId: historyId,
			instanceId: "old-inst",
			abort: false,
			abandoned: false,
			abortTask: vi.fn().mockResolvedValue(undefined),
			emit: vi.fn(),
		}

		const registry = new TaskRegistry()
		registry.push(existingTask as unknown as Task)

		const provider = {
			getCurrentTask: vi.fn(() => existingTask),
			taskRegistry: registry,
			taskHistoryStore: { get: vi.fn(() => undefined) },
			markDelegatedChildInterrupted: vi.fn().mockResolvedValue(undefined),
			get evictCurrentTask() {
				return privateClineProvider.evictCurrentTask.bind(this)
			},
			removeClineFromStack,
			addClineToStack: vi.fn().mockResolvedValue(undefined),
			log: vi.fn(),
			customModesManager: { getCustomModes: vi.fn().mockResolvedValue([]) },
			providerSettingsManager: {
				getModeConfigId: vi.fn().mockResolvedValue(undefined),
				listConfig: vi.fn().mockResolvedValue([]),
			},
			getState: vi.fn().mockResolvedValue({
				apiConfiguration: { apiProvider: "anthropic", consecutiveMistakeLimit: 0 },
				enableCheckpoints: true,
				checkpointTimeout: 60,
				experiments: {},
				cloudUserInfo: null,
				taskSyncEnabled: false,
			}),
			getPendingEditOperation: vi.fn().mockReturnValue(undefined),
			clearPendingEditOperation: vi.fn(),
			taskScheduler: { schedule: schedulespy },
			syncFocusedTaskMode: vi.fn().mockResolvedValue(undefined),
			taskEventListeners: new WeakMap(),
			performPreparationTasks: vi.fn().mockResolvedValue(undefined),
			context: { extension: { packageJSON: {} }, globalStorageUri: { fsPath: "/tmp" } },
			contextProxy: {
				extensionUri: {},
				getValue: vi.fn(),
				setValue: vi.fn(),
				setProviderSettings: vi.fn(),
				getProviderSettings: vi.fn(() => ({})),
			},
			postStateToWebview: vi.fn(),
		} as unknown as ClineProvider

		const historyItem = {
			id: historyId,
			number: 1,
			ts: Date.now(),
			task: "Task",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			workspace: "/tmp",
		}

		await privateClineProvider.createTaskWithHistoryItem.call(provider, historyItem)

		expect(runSpy).toHaveBeenCalledTimes(1)
		expect(schedulespy).not.toHaveBeenCalled()
		// evictCurrentTask must NOT have been called — in-place replace, no stack pop
		expect(removeClineFromStack).not.toHaveBeenCalled()
	})

	it("IPC StartNewTask path unfocuses the current task instead of ending it", async () => {
		const removeClineFromStack = vi.fn().mockResolvedValue(undefined)
		const createTask = vi.fn().mockResolvedValue({ taskId: "ipc-1" })

		const existingTask = { taskId: "existing-1", abort: false, abandoned: false, emit: vi.fn() }
		const registry = new TaskRegistry()
		registry.push(existingTask as unknown as Task)

		const provider = {
			context: {} as unknown,
			taskRegistry: registry,
			getCurrentTask: vi.fn(() => registry.current),
			taskHistoryStore: { get: vi.fn(() => undefined) },
			markDelegatedChildInterrupted: vi.fn().mockResolvedValue(undefined),
			get unfocusCurrentTask() {
				return privateClineProvider.unfocusCurrentTask.bind(this)
			},
			removeClineFromStack,
			postStateToWebview: vi.fn(),
			postMessageToWebview: vi.fn(),
			createTask,
			getValues: vi.fn(() => ({})),
			providerSettingsManager: { saveConfig: vi.fn() },
			on: vi.fn((ev: unknown, cb: unknown) => {
				if (ev === "taskCreated") {
					// no-op for this test
				}
				return provider
			}),
		} as unknown as ClineProvider

		const output = { appendLine: vi.fn() } as unknown as OutputChannel
		const api = new API(output, provider, undefined, false)

		const taskId = await api.startNewTask({
			configuration: {},
			text: "hello",
			images: undefined,
			newTab: false,
		})

		expect(taskId).toBe("ipc-1")
		expect(removeClineFromStack).not.toHaveBeenCalled()
		expect(createTask).toHaveBeenCalled()
		// Still resident and running, just no longer the focused task.
		expect(registry.getById("existing-1")).toBe(existingTask)
		expect(registry.current).toBeUndefined()
	})
})
