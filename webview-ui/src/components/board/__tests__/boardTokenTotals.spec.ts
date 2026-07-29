import type { BoardTask, HistoryItem } from "@roo-code/types"

import { sumBoardWorkspaceTokens } from "../boardTokenTotals"

const now = Date.now()

const card = (id: string, overrides: Partial<BoardTask> = {}): BoardTask => ({
	id,
	workspaceId: "workspace-1",
	title: id,
	stage: "done",
	position: 0,
	createdAt: now,
	updatedAt: now,
	...overrides,
})

const historyItem = (id: string, tokensIn: number, tokensOut: number, childIds?: string[]): HistoryItem => ({
	id,
	number: 1,
	ts: now,
	task: id,
	tokensIn,
	tokensOut,
	totalCost: 0,
	childIds,
})

describe("sumBoardWorkspaceTokens", () => {
	it("adds up both of a card's conversations", () => {
		const tasks = [card("card-1", { linkedRefinementTaskId: "refine-1", linkedHistoryTaskId: "run-1" })]
		const history = [historyItem("refine-1", 100, 10), historyItem("run-1", 200, 20)]

		expect(sumBoardWorkspaceTokens(tasks, history, "workspace-1")).toEqual({ tokensIn: 300, tokensOut: 30 })
	})

	it("includes subtasks at every depth", () => {
		const tasks = [card("card-1", { linkedHistoryTaskId: "run-1" })]
		const history = [
			historyItem("run-1", 100, 10, ["child-1"]),
			historyItem("child-1", 50, 5, ["grandchild-1"]),
			historyItem("grandchild-1", 25, 2),
		]

		expect(sumBoardWorkspaceTokens(tasks, history, "workspace-1")).toEqual({ tokensIn: 175, tokensOut: 17 })
	})

	it("counts a task reachable from two cards only once", () => {
		const tasks = [
			card("card-1", { linkedHistoryTaskId: "run-1" }),
			card("card-2", { linkedHistoryTaskId: "run-2" }),
		]
		const history = [
			historyItem("run-1", 100, 10, ["shared"]),
			historyItem("run-2", 100, 10, ["shared"]),
			historyItem("shared", 40, 4),
		]

		expect(sumBoardWorkspaceTokens(tasks, history, "workspace-1")).toEqual({ tokensIn: 240, tokensOut: 24 })
	})

	it("terminates on a cycle", () => {
		const tasks = [card("card-1", { linkedHistoryTaskId: "run-1" })]
		const history = [historyItem("run-1", 100, 10, ["child-1"]), historyItem("child-1", 50, 5, ["run-1"])]

		expect(sumBoardWorkspaceTokens(tasks, history, "workspace-1")).toEqual({ tokensIn: 150, tokensOut: 15 })
	})

	it("ignores other workspaces, unlinked cards, and missing history", () => {
		const tasks = [
			card("card-1", { linkedHistoryTaskId: "run-1" }),
			card("card-2"),
			card("card-3", { linkedHistoryTaskId: "deleted-run" }),
			card("card-4", { workspaceId: "workspace-2", linkedHistoryTaskId: "other-run" }),
		]
		const history = [historyItem("run-1", 100, 10), historyItem("other-run", 999, 99)]

		expect(sumBoardWorkspaceTokens(tasks, history, "workspace-1")).toEqual({ tokensIn: 100, tokensOut: 10 })
	})
})
