// npx vitest run core/webview/__tests__/kanbanBoard.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../task-persistence/taskMessages", () => ({
	readTaskMessages: vi.fn(),
}))

import type { ClineMessage } from "@roo-code/types"

import { getKanbanBoardForRootTask } from "../kanbanBoard"
import { readTaskMessages } from "../../task-persistence/taskMessages"
import type { ClineProvider } from "../ClineProvider"

function makeProvider(overrides: Record<string, unknown>) {
	return {
		contextProxy: { globalStorageUri: { fsPath: "/tmp" } },
		taskHistoryStore: { get: vi.fn().mockReturnValue(undefined) },
		getCurrentTask: vi.fn().mockReturnValue(undefined),
		...overrides,
	} as unknown as ClineProvider
}

describe("getKanbanBoardForRootTask", () => {
	beforeEach(() => {
		vi.mocked(readTaskMessages).mockReset()
	})

	it("reads the todo list from memory when the root task is the resident current task", async () => {
		const currentTask = {
			taskId: "root-1",
			todoList: [{ id: "t1", content: "Do the thing", status: "pending" }],
		}
		const provider = makeProvider({ getCurrentTask: vi.fn().mockReturnValue(currentTask) })

		const board = await getKanbanBoardForRootTask(provider, "root-1")

		expect(board.rootTaskId).toBe("root-1")
		expect(board.items).toEqual([
			{ id: "t1", content: "Do the thing", status: "pending", relatedTaskId: undefined },
		])
		expect(readTaskMessages).not.toHaveBeenCalled()
	})

	it("reads the todo list from disk via readTaskMessages when the root task is not resident", async () => {
		vi.mocked(readTaskMessages).mockResolvedValue([
			{
				type: "say",
				say: "user_edit_todos",
				text: JSON.stringify({
					tool: "updateTodoList",
					todos: [{ id: "t1", content: "Evicted task's todo", status: "pending" }],
				}),
				ts: 1,
			},
		] as ClineMessage[])
		// No resident task at all (e.g. a different task, or none) — not the requested root.
		const provider = makeProvider({ getCurrentTask: vi.fn().mockReturnValue({ taskId: "some-other-task" }) })

		const board = await getKanbanBoardForRootTask(provider, "root-2")

		expect(readTaskMessages).toHaveBeenCalledWith({ taskId: "root-2", globalStoragePath: "/tmp" })
		expect(board.items).toEqual([
			{ id: "t1", content: "Evicted task's todo", status: "pending", relatedTaskId: undefined },
		])
	})

	it("enriches items that have a relatedTaskId with a summary from task history", async () => {
		const currentTask = {
			taskId: "root-3",
			todoList: [{ id: "t1", content: "Implement auth", status: "in_progress", relatedTaskId: "child-1" }],
		}
		const historyGet = vi.fn().mockReturnValue({
			task: "Implement authentication middleware",
			status: "active",
			totalCost: 0.42,
			ts: 12345,
		})
		const provider = makeProvider({
			getCurrentTask: vi.fn().mockReturnValue(currentTask),
			taskHistoryStore: { get: historyGet },
		})

		const board = await getKanbanBoardForRootTask(provider, "root-3")

		expect(historyGet).toHaveBeenCalledWith("child-1")
		expect(board.items[0].relatedTask).toEqual({
			title: "Implement authentication middleware",
			status: "active",
			totalCost: 0.42,
			ts: 12345,
		})
	})

	it("truncates long related task titles", async () => {
		const longTitle = "x".repeat(200)
		const currentTask = {
			taskId: "root-4",
			todoList: [{ id: "t1", content: "Big task", status: "testing", relatedTaskId: "child-2" }],
		}
		const provider = makeProvider({
			getCurrentTask: vi.fn().mockReturnValue(currentTask),
			taskHistoryStore: {
				get: vi.fn().mockReturnValue({ task: longTitle, status: "completed", totalCost: 1, ts: 1 }),
			},
		})

		const board = await getKanbanBoardForRootTask(provider, "root-4")

		expect(board.items[0].relatedTask?.title.length).toBeLessThanOrEqual(83) // 80 + "..."
		expect(board.items[0].relatedTask?.title.endsWith("...")).toBe(true)
	})

	it("omits relatedTask (without throwing) when the linked history entry is missing", async () => {
		const currentTask = {
			taskId: "root-5",
			todoList: [{ id: "t1", content: "Orphaned link", status: "in_progress", relatedTaskId: "deleted-child" }],
		}
		const provider = makeProvider({
			getCurrentTask: vi.fn().mockReturnValue(currentTask),
			taskHistoryStore: { get: vi.fn().mockReturnValue(undefined) },
		})

		const board = await getKanbanBoardForRootTask(provider, "root-5")

		expect(board.items).toHaveLength(1)
		expect(board.items[0].relatedTaskId).toBe("deleted-child")
		expect(board.items[0].relatedTask).toBeUndefined()
	})

	it("populates rootTaskTitle from the root task's own history entry", async () => {
		const currentTask = {
			taskId: "root-7",
			todoList: [{ id: "t1", content: "Do the thing", status: "pending" }],
		}
		const historyGet = vi
			.fn()
			.mockImplementation((id: string) =>
				id === "root-7"
					? { task: "Add a health-check endpoint", status: "active", totalCost: 0, ts: 1 }
					: undefined,
			)
		const provider = makeProvider({
			getCurrentTask: vi.fn().mockReturnValue(currentTask),
			taskHistoryStore: { get: historyGet },
		})

		const board = await getKanbanBoardForRootTask(provider, "root-7")

		expect(board.rootTaskTitle).toBe("Add a health-check endpoint")
	})

	it("leaves rootTaskTitle undefined when the root task has no history entry", async () => {
		const currentTask = {
			taskId: "root-8",
			todoList: [{ id: "t1", content: "Do the thing", status: "pending" }],
		}
		const provider = makeProvider({
			getCurrentTask: vi.fn().mockReturnValue(currentTask),
			taskHistoryStore: { get: vi.fn().mockReturnValue(undefined) },
		})

		const board = await getKanbanBoardForRootTask(provider, "root-8")

		expect(board.rootTaskTitle).toBeUndefined()
	})

	it("returns an empty items array when there is no todo list", async () => {
		vi.mocked(readTaskMessages).mockResolvedValue([])
		const provider = makeProvider({ getCurrentTask: vi.fn().mockReturnValue(undefined) })

		const board = await getKanbanBoardForRootTask(provider, "root-6")

		expect(board).toEqual({ rootTaskId: "root-6", items: [] })
	})
})
