// npx vitest src/core/auto-approval/__tests__/boardTasks.spec.ts

import { describe, expect, it } from "vitest"

import { checkAutoApproval } from "../index"

const BOARD_TOOLS = ["createBoardTask", "readBoardTask", "updateBoardTask", "deleteBoardTask"] as const

const check = (tool: string, state: Record<string, unknown>) =>
	checkAutoApproval({
		state: { autoApprovalEnabled: true, ...state } as never,
		ask: "tool",
		text: JSON.stringify({ tool }),
	})

describe("auto-approval of board task tools", () => {
	it.each(BOARD_TOOLS)("approves %s when board tasks are always allowed", async (tool) => {
		expect(await check(tool, { alwaysAllowBoardTasks: true })).toEqual({ decision: "approve" })
	})

	it.each(BOARD_TOOLS)("asks for %s when the board toggle is off", async (tool) => {
		expect(await check(tool, { alwaysAllowBoardTasks: false })).toEqual({ decision: "ask" })
	})

	it.each(BOARD_TOOLS)("asks for %s when auto-approval is disabled entirely", async (tool) => {
		expect(
			await checkAutoApproval({
				state: { autoApprovalEnabled: false, alwaysAllowBoardTasks: true } as never,
				ask: "tool",
				text: JSON.stringify({ tool }),
			}),
		).toEqual({ decision: "ask" })
	})

	it("is not covered by the read-only or write toggles", async () => {
		const state = { alwaysAllowReadOnly: true, alwaysAllowWrite: true, alwaysAllowSubtasks: true }
		for (const tool of BOARD_TOOLS) {
			expect(await check(tool, state)).toEqual({ decision: "ask" })
		}
	})

	it("does not let the board toggle approve unrelated tools", async () => {
		expect(await check("readFile", { alwaysAllowBoardTasks: true })).toEqual({ decision: "ask" })
		expect(await check("newTask", { alwaysAllowBoardTasks: true })).toEqual({ decision: "ask" })
	})
})
