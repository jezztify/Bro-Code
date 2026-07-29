import { describe, expect, it, vi } from "vitest"

import { createBoardTaskTool } from "../CreateBoardTaskTool"
import { deleteBoardTaskTool } from "../DeleteBoardTaskTool"
import { readBoardTaskTool } from "../ReadBoardTaskTool"
import { updateBoardTaskTool } from "../UpdateBoardTaskTool"

describe("CreateBoardTaskTool", () => {
	it("creates a card in the provider's selected workspace after approval", async () => {
		const provider = {
			createBoardTaskInSelectedWorkspace: vi.fn().mockResolvedValue(undefined),
		}
		const task = {
			providerRef: { deref: () => provider },
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			didToolFailInCurrentTurn: false,
		} as any
		const callbacks = {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}

		await createBoardTaskTool.execute(
			{ title: "Document release", description: "Write release notes", stage: "scoped" },
			task,
			callbacks,
		)

		expect(callbacks.askApproval).toHaveBeenCalled()
		expect(provider.createBoardTaskInSelectedWorkspace).toHaveBeenCalledWith({
			title: "Document release",
			description: "Write release notes",
			stage: "scoped",
		})
	})

	it("reports the new card's TASK number so it can be referred to later", async () => {
		const provider = {
			createBoardTaskInSelectedWorkspace: vi.fn().mockResolvedValue({ id: "task-1", number: 12 }),
		}
		const task = {
			providerRef: { deref: () => provider },
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			didToolFailInCurrentTurn: false,
		} as any
		const callbacks = {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}

		await createBoardTaskTool.execute(
			{ title: "Document release", description: null, stage: "scoped" },
			task,
			callbacks,
		)

		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("TASK-12"))
	})

	it("does not persist a card when the user declines approval", async () => {
		const provider = { createBoardTaskInSelectedWorkspace: vi.fn() }
		const task = {
			providerRef: { deref: () => provider },
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			didToolFailInCurrentTurn: false,
		} as any
		const callbacks = {
			askApproval: vi.fn().mockResolvedValue(false),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}

		await createBoardTaskTool.execute(
			{ title: "Declined", description: null, stage: "backlog" },
			task,
			callbacks,
		)

		expect(provider.createBoardTaskInSelectedWorkspace).not.toHaveBeenCalled()
	})

	it("reads cards only through the provider's selected workspace", async () => {
		const provider = {
			readBoardTasksInSelectedWorkspace: vi.fn().mockResolvedValue([
				{ id: "task-1", title: "Document release", stage: "scoped" },
			]),
		}
		const task = { providerRef: { deref: () => provider } } as any
		const callbacks = {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}

		await readBoardTaskTool.execute({ task_id: null }, task, callbacks)

		expect(provider.readBoardTasksInSelectedWorkspace).toHaveBeenCalledWith(undefined)
		// Reads go through approval too, so they are gated by the board auto-approve
		// toggle and leave a visible trace of what was read.
		expect(callbacks.askApproval).toHaveBeenCalledWith(
			"tool",
			JSON.stringify({ tool: "readBoardTask", taskId: undefined }),
		)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Document release"))
	})

	it("does not read the board when the user declines", async () => {
		const provider = { readBoardTasksInSelectedWorkspace: vi.fn() }
		const task = { providerRef: { deref: () => provider } } as any
		const callbacks = {
			askApproval: vi.fn().mockResolvedValue(false),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}

		await readBoardTaskTool.execute({ task_id: "task-1" }, task, callbacks)

		expect(provider.readBoardTasksInSelectedWorkspace).not.toHaveBeenCalled()
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("declined"))
	})

	it("rejects a blank board task ID instead of listing all cards", async () => {
		const provider = { readBoardTasksInSelectedWorkspace: vi.fn() }
		const task = {
			providerRef: { deref: () => provider },
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			didToolFailInCurrentTurn: false,
		} as any
		const callbacks = { askApproval: vi.fn(), handleError: vi.fn(), pushToolResult: vi.fn() }

		await readBoardTaskTool.execute({ task_id: "   " }, task, callbacks)

		expect(provider.readBoardTasksInSelectedWorkspace).not.toHaveBeenCalled()
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("board task ID"))
	})

	it("updates a selected-workspace card only after approval", async () => {
		const provider = { updateBoardTaskInSelectedWorkspace: vi.fn().mockResolvedValue(undefined) }
		const task = {
			providerRef: { deref: () => provider },
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			didToolFailInCurrentTurn: false,
		} as any
		const callbacks = { askApproval: vi.fn().mockResolvedValue(true), handleError: vi.fn(), pushToolResult: vi.fn() }

		await updateBoardTaskTool.execute(
			{
				task_id: "task-1",
				title: "Publish release",
				description: null,
				stage: "approved",
				clear_description: true,
			},
			task,
			callbacks,
		)

		expect(provider.updateBoardTaskInSelectedWorkspace).toHaveBeenCalledWith("task-1", {
			title: "Publish release",
			description: null,
			stage: "approved",
		})
	})

	it("does not delete a card when the user declines approval", async () => {
		const provider = { deleteBoardTaskInSelectedWorkspace: vi.fn() }
		const task = { providerRef: { deref: () => provider } } as any
		const callbacks = { askApproval: vi.fn().mockResolvedValue(false), handleError: vi.fn(), pushToolResult: vi.fn() }

		await deleteBoardTaskTool.execute({ task_id: "task-1" }, task, callbacks)

		expect(provider.deleteBoardTaskInSelectedWorkspace).not.toHaveBeenCalled()
	})

	it.each([
		[updateBoardTaskTool, { task_id: null, title: null, description: null, stage: null, clear_description: false }],
		[deleteBoardTaskTool, { task_id: null }],
	])("returns a tool error for a malformed task ID", async (tool, params) => {
		const task = {
			providerRef: { deref: () => undefined },
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			didToolFailInCurrentTurn: false,
		} as any
		const callbacks = { askApproval: vi.fn(), handleError: vi.fn(), pushToolResult: vi.fn() }

		await tool.execute(params as never, task, callbacks)

		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("board task ID"))
	})
})