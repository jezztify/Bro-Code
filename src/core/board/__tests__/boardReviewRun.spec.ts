// npx vitest src/core/board/__tests__/boardReviewRun.spec.ts

import { describe, it, expect } from "vitest"

import type { BoardState, BoardTask } from "@roo-code/types"

import { boardReviewRunFor, boardReviewRunRefusal, lockedBoardReviewRun } from "../boardReviewRun"

const card = (overrides: Partial<BoardTask>): BoardTask => ({
	id: "card-1",
	workspaceId: "workspace-1",
	title: "Establish code base",
	stage: "backlog",
	position: 0,
	createdAt: 0,
	updatedAt: 0,
	...overrides,
})

const state = (tasks: BoardTask[]): BoardState => ({
	version: 1,
	workspaces: [],
	tasks,
	migrations: {},
})

describe("boardReviewRunFor", () => {
	it("recognises a card's refinement chat", () => {
		const board = state([card({ linkedRefinementTaskId: "refine-1" })])

		expect(boardReviewRunFor(board, "refine-1")).toBe("refine")
	})

	it("recognises a card's validation chat", () => {
		const board = state([card({ stage: "qa_validation", linkedValidationTaskId: "validate-1" })])

		expect(boardReviewRunFor(board, "validate-1")).toBe("validate")
	})

	// The execution run is the one that is *meant* to write, so it must not be pinned.
	it("leaves a card's execution run alone", () => {
		const board = state([
			card({
				stage: "in_progress",
				linkedRefinementTaskId: "refine-1",
				linkedHistoryTaskId: "execution-1",
			}),
		])

		expect(boardReviewRunFor(board, "execution-1")).toBeUndefined()
	})

	it("leaves a conversation the board has never heard of alone", () => {
		expect(boardReviewRunFor(state([card({})]), "some-other-chat")).toBeUndefined()
	})

	// A card that has been refined, implemented and sent to QA carries all three links.
	it("tells a card's three conversations apart", () => {
		const board = state([
			card({
				stage: "qa_validation",
				linkedRefinementTaskId: "refine-1",
				linkedHistoryTaskId: "execution-1",
				linkedValidationTaskId: "validate-1",
			}),
		])

		expect(boardReviewRunFor(board, "refine-1")).toBe("refine")
		expect(boardReviewRunFor(board, "validate-1")).toBe("validate")
		expect(boardReviewRunFor(board, "execution-1")).toBeUndefined()
	})
})

describe("lockedBoardReviewRun", () => {
	const conversation = (taskId: string, board?: BoardState) => ({
		taskId,
		providerRef: { deref: () => (board ? { boardStore: { getSnapshot: () => board } } : undefined) },
	})

	it("pins a refinement chat", () => {
		const board = state([card({ linkedRefinementTaskId: "refine-1" })])

		expect(lockedBoardReviewRun(conversation("refine-1", board))).toBe("refine")
	})

	it("does not pin an ordinary chat", () => {
		const board = state([card({ linkedRefinementTaskId: "refine-1" })])

		expect(lockedBoardReviewRun(conversation("chat-1", board))).toBeUndefined()
	})

	// A task outliving its provider must not be pinned by accident — nothing can be read
	// about it either way, and refusing tools on a guess would strand the conversation.
	it("does not pin when the provider is gone", () => {
		expect(lockedBoardReviewRun(conversation("refine-1"))).toBeUndefined()
	})
})

describe("boardReviewRunRefusal", () => {
	it("tells a refiner the card is not approved and what to do instead", () => {
		const refusal = boardReviewRunRefusal("refine", "switch_mode")

		expect(refusal).toContain("switch_mode")
		expect(refusal).toMatch(/has not been approved/i)
		expect(refusal).toContain("update_board_task")
	})

	it("tells a validator that fixing is a separate run", () => {
		const refusal = boardReviewRunRefusal("validate", "new_task")

		expect(refusal).toContain("new_task")
		expect(refusal).toMatch(/not this run's job/i)
		expect(refusal).toContain("attempt_completion")
	})
})
