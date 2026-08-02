import { beforeEach, describe, expect, it, vi } from "vitest"

import type { BoardTask } from "@roo-code/types"

import { readTaskMessages, saveTaskMessages } from "../../task-persistence"
import type { BoardTaskMove } from "../BoardStore"
import { postBoardTaskMoveNotice } from "../boardTaskMoveNotice"

vi.mock("../../task-persistence", () => ({
	readTaskMessages: vi.fn().mockResolvedValue([]),
	saveTaskMessages: vi.fn().mockResolvedValue(undefined),
}))

const card = (overrides: Partial<BoardTask> = {}): BoardTask => ({
	id: "card-1",
	workspaceId: "workspace-1",
	title: "Add dark mode",
	stage: "qa_validation",
	position: 0,
	createdAt: 1,
	updatedAt: 2,
	...overrides,
})

const move = (task: BoardTask): BoardTaskMove => ({
	task,
	from: "in_progress",
	to: "qa_validation",
	globalStoragePath: "/storage",
})

describe("postBoardTaskMoveNotice", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(readTaskMessages).mockResolvedValue([])
	})

	it("tells a live conversation which columns the card moved between", async () => {
		const say = vi.fn().mockResolvedValue(undefined)

		await postBoardTaskMoveNotice(move(card({ linkedHistoryTaskId: "execution-1" })), () => ({ say }))

		expect(say).toHaveBeenCalledWith(
			"board_task_moved",
			JSON.stringify({ from: "in_progress", to: "qa_validation" }),
			undefined,
			undefined,
			undefined,
			undefined,
			{ isNonInteractive: true },
		)
		// A live conversation owns its messages; writing the file behind its back would
		// be overwritten by its next save.
		expect(saveTaskMessages).not.toHaveBeenCalled()
	})

	it("does not supersede a question the live conversation is waiting on", async () => {
		const say = vi.fn().mockResolvedValue(undefined)

		await postBoardTaskMoveNotice(move(card({ linkedRefinementTaskId: "refine-1" })), () => ({ say }))

		// An interactive say bumps `lastMessageTs` and cancels the pending ask, which
		// restarts the conversation's loop - approving a card must not cost a model turn.
		expect(say.mock.calls[0][6]).toEqual({ isNonInteractive: true })
	})

	it("appends to the stored conversation when nothing is live", async () => {
		vi.mocked(readTaskMessages).mockResolvedValue([{ type: "say", say: "text", text: "Earlier", ts: 1 }])

		await postBoardTaskMoveNotice(move(card({ linkedHistoryTaskId: "execution-1" })), () => undefined)

		expect(readTaskMessages).toHaveBeenCalledWith({ taskId: "execution-1", globalStoragePath: "/storage" })
		const saved = vi.mocked(saveTaskMessages).mock.calls[0][0]
		expect(saved.taskId).toBe("execution-1")
		expect(saved.messages).toHaveLength(2)
		expect(saved.messages[1]).toMatchObject({
			type: "say",
			say: "board_task_moved",
			text: JSON.stringify({ from: "in_progress", to: "qa_validation" }),
		})
	})

	it("writes into the card's latest conversation", async () => {
		await postBoardTaskMoveNotice(
			move(
				card({
					linkedRefinementTaskId: "refine-1",
					linkedHistoryTaskId: "execution-1",
					linkedValidationTaskId: "validate-1",
				}),
			),
			() => undefined,
		)

		expect(readTaskMessages).toHaveBeenCalledWith({ taskId: "validate-1", globalStoragePath: "/storage" })
	})

	it("says nothing about a card that has no conversation yet", async () => {
		const say = vi.fn()

		await postBoardTaskMoveNotice(move(card()), () => ({ say }))

		expect(say).not.toHaveBeenCalled()
		expect(saveTaskMessages).not.toHaveBeenCalled()
	})
})
