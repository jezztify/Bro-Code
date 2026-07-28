// npx vitest run __tests__/provider-delegation.spec.ts

import { describe, it, expect, vi } from "vitest"
import type { HistoryItem, ClineMessage } from "@roo-code/types"
import { RooCodeEventName } from "@roo-code/types"
import { ClineProvider } from "../core/webview/ClineProvider"
import { TaskScheduler } from "../core/task/TaskScheduler"
import { getLatestTodo } from "../shared/todo"

const parentHistoryItem: HistoryItem = {
	id: "parent-1",
	task: "Parent",
	tokensIn: 0,
	tokensOut: 0,
	totalCost: 0,
	childIds: [],
} as unknown as HistoryItem

/** Minimal taskHistoryStore stub whose atomicReadAndUpdate calls the updater with the parent item. */
function makeStoreStub(
	overrides: Partial<{ atomicReadAndUpdate: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> }> = {},
) {
	return {
		atomicReadAndUpdate: vi.fn(async (_taskId: string, updater: (h: HistoryItem) => HistoryItem) => {
			updater(parentHistoryItem)
			return []
		}),
		get: vi.fn().mockReturnValue(undefined),
		...overrides,
	}
}

/**
 * Parent task double with the methods delegateParentAndOpenChild reads from
 * `parent`. Without flushPendingToolResultsToHistory the method hits its
 * non-fatal flush-error branch and never reaches the happy delegation path.
 */
const makeParentTask = () =>
	({
		taskId: "parent-1",
		emit: vi.fn(),
		flushPendingToolResultsToHistory: vi.fn().mockResolvedValue(true),
		retrySaveApiConversationHistory: vi.fn(),
	}) as any

describe("ClineProvider.delegateParentAndOpenChild()", () => {
	it("persists parent delegation metadata via atomicReadAndUpdate and emits TaskDelegated", async () => {
		const providerEmit = vi.fn()
		const parentTask = makeParentTask()

		const childRun = vi.fn().mockResolvedValue(undefined)
		const removeClineFromStack = vi.fn().mockResolvedValue(undefined)
		const createTask = vi.fn().mockResolvedValue({ taskId: "child-1", start: vi.fn(), run: childRun })
		const handleModeSwitch = vi.fn().mockResolvedValue(undefined)
		const taskHistoryStore = makeStoreStub()

		const provider = {
			taskScheduler: new TaskScheduler(),
			emit: providerEmit,
			getCurrentTask: vi.fn(() => parentTask),
			removeClineFromStack,
			createTask,
			handleModeSwitch,
			log: vi.fn(),
			isViewLaunched: false,
			recentTasksCache: undefined,
			taskHistoryStore,
		} as unknown as ClineProvider

		const child = await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, {
			parentTaskId: "parent-1",
			message: "Do something",
			initialTodos: [],
			mode: "code",
		})
		await Promise.resolve() // drain scheduler microtask so child.run() is invoked

		expect(child.taskId).toBe("child-1")

		// Invariant: parent closed before child creation
		expect(removeClineFromStack).toHaveBeenCalledTimes(1)

		// Child task created with startTask: false and initialStatus: "active"
		expect(createTask).toHaveBeenCalledWith("Do something", undefined, parentTask, {
			initialTodos: [],
			initialStatus: "active",
			startTask: false,
		})

		// Delegation metadata written via atomicReadAndUpdate with correct taskId
		expect(taskHistoryStore.atomicReadAndUpdate).toHaveBeenCalledTimes(1)
		const [calledTaskId, updater] = taskHistoryStore.atomicReadAndUpdate.mock.calls[0]
		expect(calledTaskId).toBe("parent-1")

		// The updater must produce the correct delegation fields
		const result = updater(parentHistoryItem)
		expect(result).toMatchObject({
			id: "parent-1",
			status: "delegated",
			delegatedToId: "child-1",
			awaitingChildId: "child-1",
			childIds: expect.arrayContaining(["child-1"]),
		})

		// child.run() called AFTER parent metadata is persisted (via taskScheduler)
		expect(childRun).toHaveBeenCalledTimes(1)

		// Provider-level event
		expect(providerEmit).toHaveBeenCalledWith(RooCodeEventName.TaskDelegated, "parent-1", "child-1")

		// Mode switch
		expect(handleModeSwitch).toHaveBeenCalledWith("code")
	})

	it("with todoId: flips the linked item to in_progress, links relatedTaskId, and persists via say() before disposal", async () => {
		const providerEmit = vi.fn()
		const parentSay = vi.fn().mockResolvedValue(undefined)
		const parentTask = {
			...makeParentTask(),
			todoList: [
				{ id: "todo-1", content: "Implement auth", status: "pending" },
				{ id: "todo-2", content: "Write tests", status: "pending" },
			],
			say: parentSay,
		}

		const createTask = vi.fn().mockResolvedValue({ taskId: "child-1", start: vi.fn() })
		const taskHistoryStore = makeStoreStub()

		const provider = {
			emit: providerEmit,
			getCurrentTask: vi.fn(() => parentTask),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTask,
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			log: vi.fn(),
			isViewLaunched: false,
			recentTasksCache: undefined,
			taskHistoryStore,
			broadcastKanbanBoardIfWatched: vi.fn().mockResolvedValue(undefined),
		} as unknown as ClineProvider

		await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, {
			parentTaskId: "parent-1",
			message: "Do something",
			initialTodos: [],
			mode: "code",
			todoId: "todo-1",
		})

		// The linked item flips to in_progress and gains a relatedTaskId; the unrelated item
		// is left untouched.
		expect(parentTask.todoList[0].status).toBe("in_progress")
		expect(parentTask.todoList[0].relatedTaskId).toBeTruthy()
		expect(parentTask.todoList[1]).toEqual({ id: "todo-2", content: "Write tests", status: "pending" })

		// Persisted through the same message-log mechanism update_todo_list uses, on the
		// still-resident parent, BEFORE disposal (removeClineFromStack) is invoked.
		expect(parentSay).toHaveBeenCalledWith("user_edit_todos", expect.stringContaining('"tool":"updateTodoList"'))
		const sayCallOrder = parentSay.mock.invocationCallOrder[0]
		const disposeCallOrder = (provider.removeClineFromStack as any).mock.invocationCallOrder[0]
		expect(sayCallOrder).toBeLessThan(disposeCallOrder)

		// The child is created with the same pre-generated id that was linked via relatedTaskId
		// (so the board card's relatedTaskId already points at the real child before it exists).
		const createTaskCallOptions = createTask.mock.calls[0][3]
		expect(createTaskCallOptions.taskId).toBe(parentTask.todoList[0].relatedTaskId)

		// Durability: replaying the say() payload through the same message-log mechanism used
		// on resume (getLatestTodo) reconstructs the in_progress status and relatedTaskId link,
		// proving the link survives a simulated reload rather than only living in memory.
		const [sayType, sayText] = parentSay.mock.calls[0]
		const replayedMessages: ClineMessage[] = [{ type: "say", say: sayType, text: sayText, ts: Date.now() }]
		const replayedTodos = getLatestTodo(replayedMessages)
		expect(replayedTodos[0]).toMatchObject({
			id: "todo-1",
			status: "in_progress",
			relatedTaskId: parentTask.todoList[0].relatedTaskId,
		})
	})

	it("with todoId: the child ends up as the current task on the stack, with no rollback", async () => {
		// Regression test for the bug where a todoId-linked delegation created the child but
		// the webview stayed stuck on the parent's auto-generated "user_edit_todos" message
		// instead of switching into it. `say()` here mimics the real Task#say ->
		// addToClineMessages -> provider.postStateToWebviewWithoutTaskHistory() chain: it
		// mutates the (mocked) provider's notion of "current task" via getCurrentTask, and
		// records every state push so we can assert the child's push happens, is not clobbered,
		// and no rollback path (deleteTaskWithId / createTaskWithHistoryItem) ever runs.
		let current: any
		const postStateCalls: Array<{ currentTaskId: string | undefined }> = []

		const parentTask = {
			...makeParentTask(),
			taskId: "parent-1",
			todoList: [{ id: "todo-1", content: "Implement auth", status: "pending" }],
			say: vi.fn(async () => {
				// Real Task#say posts state while `this` (the parent) is still current.
				await provider.postStateToWebviewWithoutTaskHistory()
			}),
		}
		current = parentTask

		const deleteTaskWithId = vi.fn()
		const createTaskWithHistoryItem = vi.fn()
		const getTaskWithId = vi.fn()

		const createTask = vi.fn().mockImplementation(async (_msg, _images, _parent, options) => {
			const child = { taskId: options.taskId ?? "child-1", start: vi.fn() }
			current = child
			return child
		})

		const provider = {
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => current),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTask,
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			postStateToWebviewWithoutTaskHistory: vi.fn(async () => {
				postStateCalls.push({ currentTaskId: current?.taskId })
			}),
			log: vi.fn(),
			isViewLaunched: false,
			recentTasksCache: undefined,
			taskHistoryStore: makeStoreStub(),
			broadcastKanbanBoardIfWatched: vi.fn().mockResolvedValue(undefined),
			deleteTaskWithId,
			createTaskWithHistoryItem,
			getTaskWithId,
		} as unknown as ClineProvider

		const child = await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, {
			parentTaskId: "parent-1",
			message: "Do something",
			initialTodos: [],
			mode: "code",
			todoId: "todo-1",
		})

		// The child returned by delegateParentAndOpenChild is the same one left "current".
		// (todoId delegations pre-generate the child's id via uuidv7, so it won't be "child-1".)
		expect(child.taskId).toBeTruthy()
		expect(child.taskId).not.toBe("parent-1")
		expect(provider.getCurrentTask()).toBe(child)

		// Two state pushes happened: the interim one while the parent was still current (from
		// say(), step 1b) and the optimistic one once the child became current (step 4b) - and
		// the LAST push on record reflects the child, not the parent.
		expect(postStateCalls.length).toBeGreaterThanOrEqual(2)
		expect(postStateCalls[0].currentTaskId).toBe("parent-1")
		expect(postStateCalls.at(-1)?.currentTaskId).toBe(child.taskId)

		// No rollback: the parent is closed exactly once (the normal disposal in step 3), and
		// the child-deletion / parent-restore rollback path never runs.
		expect(provider.removeClineFromStack).toHaveBeenCalledTimes(1)
		expect(deleteTaskWithId).not.toHaveBeenCalled()
		expect(createTaskWithHistoryItem).not.toHaveBeenCalled()
		expect(getTaskWithId).not.toHaveBeenCalled()
	})

	it("without todoId: does not touch the todo list or call say()", async () => {
		const parentSay = vi.fn()
		const parentTask = {
			...makeParentTask(),
			todoList: [{ id: "todo-1", content: "Implement auth", status: "pending" }],
			say: parentSay,
		}

		const provider = {
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => parentTask),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTask: vi.fn().mockResolvedValue({ taskId: "child-1", start: vi.fn() }),
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			log: vi.fn(),
			isViewLaunched: false,
			recentTasksCache: undefined,
			taskHistoryStore: makeStoreStub(),
		} as unknown as ClineProvider

		await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, {
			parentTaskId: "parent-1",
			message: "Do something",
			initialTodos: [],
			mode: "code",
		})

		expect(parentSay).not.toHaveBeenCalled()
		expect(parentTask.todoList[0].status).toBe("pending")
	})

	it("optimistically posts state (without taskHistory) right after child creation, before persisting parent metadata", async () => {
		const parentTask = makeParentTask()
		const callOrder: string[] = []

		const createTask = vi.fn().mockImplementation(async () => {
			callOrder.push("createTask")
			return { taskId: "child-1", start: vi.fn() }
		})
		const postStateToWebviewWithoutTaskHistory = vi.fn().mockImplementation(async () => {
			callOrder.push("postStateToWebviewWithoutTaskHistory")
		})
		const taskHistoryStore = makeStoreStub({
			atomicReadAndUpdate: vi.fn(async (_taskId: string, updater: (h: HistoryItem) => HistoryItem) => {
				callOrder.push("atomicReadAndUpdate")
				updater(parentHistoryItem)
				return []
			}),
		})

		const provider = {
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => parentTask),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTask,
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			postStateToWebviewWithoutTaskHistory,
			log: vi.fn(),
			isViewLaunched: false,
			recentTasksCache: undefined,
			taskHistoryStore,
		} as unknown as ClineProvider

		await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, {
			parentTaskId: "parent-1",
			message: "Do something",
			initialTodos: [],
			mode: "code",
		})

		// The webview must learn the child is current (so the chat view renders it
		// immediately instead of briefly falling back to the homepage) before the
		// slower parent-metadata persistence step, not after.
		expect(postStateToWebviewWithoutTaskHistory).toHaveBeenCalledTimes(1)
		expect(callOrder).toEqual(["createTask", "postStateToWebviewWithoutTaskHistory", "atomicReadAndUpdate"])
	})

	it("does not fail delegation when the optimistic state push throws", async () => {
		const parentTask = makeParentTask()
		const childStart = vi.fn()

		const provider = {
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => parentTask),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTask: vi.fn().mockResolvedValue({ taskId: "child-1", start: childStart }),
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			postStateToWebviewWithoutTaskHistory: vi.fn().mockRejectedValue(new Error("boom")),
			log: vi.fn(),
			isViewLaunched: false,
			recentTasksCache: undefined,
			taskHistoryStore: makeStoreStub(),
		} as unknown as ClineProvider

		const child = await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, {
			parentTaskId: "parent-1",
			message: "Do something",
			initialTodos: [],
			mode: "code",
		})

		expect(child.taskId).toBe("child-1")
		expect(childStart).toHaveBeenCalledTimes(1)
	})

	it("posts taskHistoryItemUpdated to the webview when isViewLaunched is true", async () => {
		const updatedParent = { ...parentHistoryItem, status: "delegated" } as HistoryItem
		const postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		const parentTask = makeParentTask()
		const taskHistoryStore = makeStoreStub({
			get: vi.fn().mockReturnValue(updatedParent),
		})

		const provider = {
			taskScheduler: new TaskScheduler(),
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => parentTask),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTask: vi.fn().mockResolvedValue({ taskId: "child-1", start: vi.fn(), run: () => Promise.resolve() }),
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			postMessageToWebview,
			log: vi.fn(),
			isViewLaunched: true,
			recentTasksCache: undefined,
			taskHistoryStore,
		} as unknown as ClineProvider

		await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, {
			parentTaskId: "parent-1",
			message: "Do something",
			initialTodos: [],
			mode: "code",
		})

		expect(postMessageToWebview).toHaveBeenCalledWith({
			type: "taskHistoryItemUpdated",
			taskHistoryItem: updatedParent,
		})
	})

	it("skips postMessageToWebview when isViewLaunched is true but store returns undefined", async () => {
		const postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		const parentTask = makeParentTask()
		const taskHistoryStore = makeStoreStub({
			get: vi.fn().mockReturnValue(undefined),
		})

		const provider = {
			taskScheduler: new TaskScheduler(),
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => parentTask),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTask: vi.fn().mockResolvedValue({ taskId: "child-1", start: vi.fn(), run: () => Promise.resolve() }),
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			postMessageToWebview,
			log: vi.fn(),
			isViewLaunched: true,
			recentTasksCache: undefined,
			taskHistoryStore,
		} as unknown as ClineProvider

		await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, {
			parentTaskId: "parent-1",
			message: "Do something",
			initialTodos: [],
			mode: "code",
		})

		expect(postMessageToWebview).not.toHaveBeenCalled()
	})

	it("calls child.run() only after atomicReadAndUpdate completes (no race condition)", async () => {
		const callOrder: string[] = []

		const parentTask = makeParentTask()
		const childRun = vi.fn(async () => callOrder.push("child.run"))
		const removeClineFromStack = vi.fn().mockResolvedValue(undefined)
		const createTask = vi.fn(async () => {
			callOrder.push("createTask")
			return { taskId: "child-1", start: vi.fn(), run: childRun }
		})
		const handleModeSwitch = vi.fn().mockResolvedValue(undefined)
		const taskHistoryStore = makeStoreStub({
			atomicReadAndUpdate: vi.fn(async (_taskId: string, _updater: (h: HistoryItem) => HistoryItem) => {
				callOrder.push("atomicReadAndUpdate")
				return []
			}),
		})

		const provider = {
			taskScheduler: new TaskScheduler(),
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => parentTask),
			removeClineFromStack,
			createTask,
			handleModeSwitch,
			log: vi.fn(),
			isViewLaunched: false,
			recentTasksCache: undefined,
			taskHistoryStore,
		} as unknown as ClineProvider

		await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, {
			parentTaskId: "parent-1",
			message: "Do something",
			initialTodos: [],
			mode: "code",
		})
		await Promise.resolve() // drain scheduler microtask so child.run() is invoked

		// createTask → atomicReadAndUpdate → child.run: scheduler admits child only after metadata is persisted
		expect(callOrder).toEqual(["createTask", "atomicReadAndUpdate", "child.run"])
	})

	it("implicitly severs interrupted awaited child and re-delegates when parent is already delegated", async () => {
		const oldChildId = "old-child"
		const oldChild = { id: oldChildId, status: "interrupted" } as unknown as HistoryItem
		const alreadyDelegatedParent: HistoryItem = {
			...parentHistoryItem,
			status: "delegated",
			awaitingChildId: oldChildId,
			delegatedToId: oldChildId,
			childIds: [oldChildId],
		} as unknown as HistoryItem

		const taskHistoryStore = makeStoreStub({
			// store returns: parent (delegated), old child (interrupted)
			get: vi.fn((id: string) =>
				id === "parent-1" ? alreadyDelegatedParent : id === oldChildId ? oldChild : undefined,
			),
			atomicReadAndUpdate: vi.fn(async (_taskId: string, updater: (h: HistoryItem) => HistoryItem) => {
				updater(alreadyDelegatedParent)
				return []
			}),
		})

		const provider = {
			taskScheduler: new TaskScheduler(),
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => makeParentTask()),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTask: vi.fn().mockResolvedValue({ taskId: "child-2", start: vi.fn(), run: () => Promise.resolve() }),
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			log: vi.fn(),
			isViewLaunched: false,
			recentTasksCache: undefined,
			taskHistoryStore,
		} as unknown as ClineProvider

		await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, {
			parentTaskId: "parent-1",
			message: "Continue",
			initialTodos: [],
			mode: "code",
		})

		// The updater must sever the old link and apply the new delegation
		const [, updater] = taskHistoryStore.atomicReadAndUpdate.mock.calls[0]
		const result = updater(alreadyDelegatedParent)
		expect(result).toMatchObject({
			status: "delegated",
			awaitingChildId: "child-2",
			delegatedToId: "child-2",
		})
		// Old child ID preserved in childIds (audit trail)
		expect(result.childIds).toContain(oldChildId)
		expect(result.childIds).toContain("child-2")
	})

	it("rejects with 'Cannot re-delegate' when the existing awaited child is still active", async () => {
		const oldChildId = "old-child"
		const activeChild = { id: oldChildId, status: "active" } as unknown as HistoryItem
		const alreadyDelegatedParent: HistoryItem = {
			...parentHistoryItem,
			status: "delegated",
			awaitingChildId: oldChildId,
			delegatedToId: oldChildId,
		} as unknown as HistoryItem

		const child = { taskId: "child-2", start: vi.fn(), run: vi.fn().mockResolvedValue(undefined) }
		const getCurrentTask = vi.fn().mockReturnValue(makeParentTask())
		const createTask = vi.fn().mockImplementation(async () => {
			getCurrentTask.mockReturnValue(child)
			return child
		})

		const taskHistoryStore = makeStoreStub({
			get: vi.fn((id: string) =>
				id === "parent-1" ? alreadyDelegatedParent : id === oldChildId ? activeChild : undefined,
			),
			// Real atomicReadAndUpdate behaviour: call the updater and propagate any throw
			atomicReadAndUpdate: vi.fn(async (_taskId: string, updater: (h: HistoryItem) => HistoryItem) => {
				updater(alreadyDelegatedParent)
				return []
			}),
		})

		const provider = {
			taskScheduler: new TaskScheduler(),
			emit: vi.fn(),
			getCurrentTask,
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTask,
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			deleteTaskWithId: vi.fn().mockResolvedValue(undefined),
			getTaskWithId: vi.fn().mockResolvedValue({ historyItem: alreadyDelegatedParent }),
			createTaskWithHistoryItem: vi.fn().mockResolvedValue(undefined),
			log: vi.fn(),
			isViewLaunched: false,
			recentTasksCache: undefined,
			taskHistoryStore,
		} as unknown as ClineProvider

		await expect(
			(ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, {
				parentTaskId: "parent-1",
				message: "Continue",
				initialTodos: [],
				mode: "code",
			}),
		).rejects.toThrow("Cannot re-delegate")

		// Rollback: child must not have run, and must be cleaned up
		expect(child.run).not.toHaveBeenCalled()
		expect((provider as any).deleteTaskWithId).toHaveBeenCalledWith("child-2", false)
	})

	it("rolls back the paused child and restores the parent when atomicReadAndUpdate fails", async () => {
		const persistError = new Error("parent metadata persist failed")
		const parentTask = makeParentTask()
		const childRun = vi.fn().mockResolvedValue(undefined)
		const removeClineFromStack = vi.fn().mockResolvedValue(undefined)
		const deleteTaskWithId = vi.fn().mockResolvedValue(undefined)
		const createTaskWithHistoryItem = vi.fn().mockResolvedValue(undefined)
		const getTaskWithId = vi.fn().mockResolvedValue({ historyItem: parentHistoryItem })

		const taskHistoryStore = makeStoreStub({
			atomicReadAndUpdate: vi.fn().mockRejectedValue(persistError),
		})

		const child = { taskId: "child-1", start: vi.fn(), run: childRun }
		// Before createTask: getCurrentTask returns parent (used by step 3 close).
		// After createTask: returns child so the rollback guard passes and the child is popped.
		const getCurrentTask = vi.fn().mockReturnValue(parentTask)
		const createTask = vi.fn().mockImplementation(async () => {
			getCurrentTask.mockReturnValue(child)
			return child
		})

		const provider = {
			taskScheduler: new TaskScheduler(),
			emit: vi.fn(),
			getCurrentTask,
			removeClineFromStack,
			createTask,
			getTaskWithId,
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			deleteTaskWithId,
			createTaskWithHistoryItem,
			log: vi.fn(),
			isViewLaunched: false,
			recentTasksCache: undefined,
			taskHistoryStore,
		} as unknown as ClineProvider

		await expect(
			(ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, {
				parentTaskId: "parent-1",
				message: "Do something",
				initialTodos: [],
				mode: "code",
			}),
		).rejects.toThrow(persistError)

		expect(childRun).not.toHaveBeenCalled()
		expect(removeClineFromStack).toHaveBeenNthCalledWith(1)
		expect(removeClineFromStack).toHaveBeenNthCalledWith(2)
		expect(deleteTaskWithId).toHaveBeenCalledWith("child-1", false)
		expect(createTaskWithHistoryItem).toHaveBeenCalledWith(parentHistoryItem)
	})
})
