// npx vitest run src/__tests__/board.spec.ts

import { describe, expect, it } from "vitest"

import { formatBoardTaskNumber, parseBoardCompletionVerdict, parseBoardTaskNumber } from "../board.js"

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

describe("parseBoardCompletionVerdict", () => {
	it.each([
		["BLOCKED — the dev server exits before it binds a port.", "blocked"],
		["PASSED — every criterion is met.", "passed"],
		["PASS", "passed"],
		["**BLOCKED**", "blocked"],
		["## Status: BLOCKED", "blocked"],
		["- result: PASSED", "passed"],
		["Verdict = BLOCKED", "blocked"],
	])("reads %j as %s", (text, expected) => {
		expect(parseBoardCompletionVerdict(text)).toBe(expected)
	})

	it("takes the verdict a report ends on, not the one it recounts", () => {
		const report = ["The card was BLOCKED on its previous pass.", "", "Result: PASSED"].join("\n")

		expect(parseBoardCompletionVerdict(report)).toBe("passed")
	})

	it("reads the label through the reason that follows it", () => {
		const report = [
			"BLOCKED",
			"",
			"PRODUCT DEFECT: the entry list renders before its fetch resolves,",
			"so the first paint is always empty.",
		].join("\n")

		expect(parseBoardCompletionVerdict(report)).toBe("blocked")
	})

	it.each([
		// Prose, not a status label — a run explaining itself has not declared a verdict.
		"The build is blocked on a missing dependency.",
		// A per-check row inside a report, which says nothing about the run as a whole.
		"  C[Check 3: PASS]",
		"| build | PASS |",
		// A field that merely names the blocker rather than being one.
		"blocker: null",
		"",
	])("does not read a verdict out of %j", (text) => {
		expect(parseBoardCompletionVerdict(text)).toBeUndefined()
	})

	it("has no verdict for a run that never stated one", () => {
		expect(parseBoardCompletionVerdict(undefined)).toBeUndefined()
	})
})
