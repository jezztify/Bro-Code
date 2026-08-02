import React from "react"

import type { BoardActivityEntry } from "@roo-code/types"

import { render, screen, within } from "@/utils/test-utils"

import BoardActivityColumn from "../BoardActivityColumn"

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) =>
			({
				"board:columns.activityLog": "Activity Log",
				"board:columns.approved": "Approved",
				"board:columns.inProgress": "In Progress",
				"board:columns.qaValidation": "QA Validation",
				"board:columns.done": "Done",
				"board:activity.empty": "No moves recorded yet.",
				"board:activity.unknownMode": "no mode",
				"board:activity.unknownApiConfig": "no API config",
				"board:activity.outcome.passed": "PASSED",
				"board:activity.outcome.blocked": "BLOCKED",
			})[key] ?? key,
	}),
}))

const entry = (overrides: Partial<BoardActivityEntry> = {}): BoardActivityEntry => ({
	id: "entry-1",
	workspaceId: "workspace-1",
	taskId: "task-1",
	taskNumber: 12,
	taskTitle: "Implement the thing",
	from: "approved",
	to: "in_progress",
	outcome: "passed",
	mode: "code",
	apiConfigName: "Anthropic prod",
	at: Date.now(),
	...overrides,
})

describe("BoardActivityColumn", () => {
	it("renders an entry as reference, mode and API configuration, outcome, then the move", () => {
		render(<BoardActivityColumn entries={[entry()]} />)

		expect(screen.getByTestId("board-activity-entry-entry-1").textContent).toBe(
			"[TASK-12] [code - Anthropic prod] [PASSED] Approved -> In Progress",
		)
	})

	it("names a returned card's move as blocked", () => {
		render(
			<BoardActivityColumn entries={[entry({ from: "qa_validation", to: "in_progress", outcome: "blocked" })]} />,
		)

		expect(screen.getByTestId("board-activity-entry-entry-1").textContent).toContain(
			"[BLOCKED] QA Validation -> In Progress",
		)
	})

	it("shows the most recent move first", () => {
		render(
			<BoardActivityColumn
				entries={[
					entry({ id: "older", from: "approved", to: "in_progress" }),
					entry({ id: "newer", from: "qa_validation", to: "done" }),
				]}
			/>,
		)

		const rendered = within(screen.getByTestId("board-column-activity"))
			.getAllByTestId(/^board-activity-entry-/)
			.map((element) => element.getAttribute("data-testid"))

		expect(rendered).toEqual(["board-activity-entry-newer", "board-activity-entry-older"])
	})

	it("stands in for a mode and API configuration a move was recorded without", () => {
		render(<BoardActivityColumn entries={[entry({ mode: undefined, apiConfigName: undefined })]} />)

		expect(screen.getByTestId("board-activity-entry-entry-1").textContent).toContain("[no mode - no API config]")
	})

	it("falls back to the card's title when it was never numbered", () => {
		render(<BoardActivityColumn entries={[entry({ taskNumber: undefined })]} />)

		expect(screen.getByTestId("board-activity-entry-entry-1").textContent).toContain("[Implement the thing]")
	})

	it("says so when nothing has happened yet", () => {
		render(<BoardActivityColumn entries={[]} />)

		expect(screen.getByText("No moves recorded yet.")).toBeInTheDocument()
	})
})
