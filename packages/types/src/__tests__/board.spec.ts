// npx vitest run src/__tests__/board.spec.ts

import { describe, expect, it } from "vitest"

import { formatBoardTaskNumber, parseBoardTaskNumber } from "../board.js"

describe("formatBoardTaskNumber", () => {
	it("renders a card's number the way the board shows it", () => {
		expect(formatBoardTaskNumber(142)).toBe("TASK-142")
	})

	it("has nothing to show for a card that has not been numbered yet", () => {
		expect(formatBoardTaskNumber(undefined)).toBeUndefined()
	})
})

describe("parseBoardTaskNumber", () => {
	it.each(["TASK-12", "task-12", "TASK 12", "task_12", "TASK12", "12", "  TASK-12  "])(
		"reads %s as card 12",
		(reference) => {
			expect(parseBoardTaskNumber(reference)).toBe(12)
		},
	)

	it.each(["", "TASK-", "TASK-0", "TASK-1.5", "TASK-12a", "0198c0f2-8f4a-7a1e-9c3d-2f1b6d5e4a3c"])(
		"does not read %s as a card number",
		(reference) => {
			expect(parseBoardTaskNumber(reference)).toBeUndefined()
		},
	)
})
