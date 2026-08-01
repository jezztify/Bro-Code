import React from "react"
import { render, screen } from "@/utils/test-utils"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { ChatRowContent } from "../ChatRow"

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) => {
			const translations: Record<string, string> = {
				"board:movedNotice": `This task was moved from ${options?.from} to ${options?.to}`,
				"board:columns.inProgress": "In Progress",
				"board:columns.qaValidation": "QA Validation",
				"chat:boardTasks.wantsToCreate": "Zoo wants to create a board task:",
				"chat:boardTasks.wantsToRead": "Zoo wants to read the board:",
				"chat:boardTasks.wantsToUpdate": "Zoo wants to update a board task:",
				"chat:boardTasks.didUpdate": "Zoo updated a board task:",
				"chat:boardTasks.wantsToDelete": "Zoo wants to delete a board task:",
				"chat:boardTasks.card": "Card",
				"chat:boardTasks.title": "Title",
				"chat:boardTasks.description": "Description",
				"chat:boardTasks.stage": "Stage",
				"chat:boardTasks.cleared": "(cleared)",
				"chat:boardTasks.allCards": "All cards in the selected workspace",
			}
			return translations[key] || key
		},
	}),
	Trans: ({ i18nKey, children }: { i18nKey: string; children?: React.ReactNode }) => <>{children || i18nKey}</>,
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeBadge: ({ children, ...props }: { children: React.ReactNode }) => <span {...props}>{children}</span>,
}))

const queryClient = new QueryClient()

const renderMessage = (message: Record<string, unknown>) =>
	render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ChatRowContent
					message={{ ts: Date.now(), partial: false, ...message } as never}
					isExpanded={false}
					isLast={false}
					isStreaming={false}
					onToggleExpand={vi.fn()}
					onSuggestionClick={vi.fn()}
					onBatchFileResponse={vi.fn()}
					onFollowUpUnmount={vi.fn()}
					isFollowUpAnswered={false}
				/>
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)

const renderRow = (type: "ask", tool: Record<string, unknown>) =>
	renderMessage({ type, ask: "tool", text: JSON.stringify(tool) })

describe("ChatRow - board task tools", () => {
	beforeEach(() => vi.clearAllMocks())

	it("shows what a card creation will contain", () => {
		renderRow("ask", {
			tool: "createBoardTask",
			title: "Add dark mode",
			description: "Follow the VS Code theme",
			stage: "backlog",
		})

		expect(screen.getByText("Zoo wants to create a board task:")).toBeInTheDocument()
		expect(screen.getByText("Add dark mode")).toBeInTheDocument()
		expect(screen.getByText("Follow the VS Code theme")).toBeInTheDocument()
		expect(screen.getByText("backlog")).toBeInTheDocument()
	})

	it("shows the card and the fields an update will change", () => {
		renderRow("ask", {
			tool: "updateBoardTask",
			taskId: "card-1",
			update: { title: "Sharpened title", stage: "scoped" },
		})

		expect(screen.getByText("Zoo wants to update a board task:")).toBeInTheDocument()
		expect(screen.getByText("card-1")).toBeInTheDocument()
		expect(screen.getByText("Sharpened title")).toBeInTheDocument()
		expect(screen.getByText("scoped")).toBeInTheDocument()
		// Fields the update leaves alone are not listed as blank rows.
		expect(screen.queryByText("Description:")).not.toBeInTheDocument()
	})

	it("marks a cleared description rather than omitting it", () => {
		renderRow("ask", {
			tool: "updateBoardTask",
			taskId: "card-1",
			update: { description: null },
		})

		expect(screen.getByText("(cleared)")).toBeInTheDocument()
	})

	it("says which card a delete targets", () => {
		renderRow("ask", { tool: "deleteBoardTask", taskId: "card-9" })

		expect(screen.getByText("Zoo wants to delete a board task:")).toBeInTheDocument()
		expect(screen.getByText("card-9")).toBeInTheDocument()
	})

	it("spells out that a read with no id covers the whole workspace", () => {
		renderRow("ask", { tool: "readBoardTask" })

		expect(screen.getByText("Zoo wants to read the board:")).toBeInTheDocument()
		expect(screen.getByText("All cards in the selected workspace")).toBeInTheDocument()
	})
})

describe("ChatRow - board task moved", () => {
	beforeEach(() => vi.clearAllMocks())

	const renderMove = (move: Record<string, unknown>) =>
		renderMessage({ type: "say", say: "board_task_moved", text: JSON.stringify(move) })

	it("names the columns the card moved between the way the board's headers do", () => {
		renderMove({ from: "in_progress", to: "qa_validation" })

		expect(screen.getByTestId("board-task-moved-row")).toHaveTextContent(
			"This task was moved from In Progress to QA Validation",
		)
	})

	it("renders nothing rather than a half-written sentence when the move is unreadable", () => {
		renderMove({ from: "in_progress" })

		expect(screen.queryByTestId("board-task-moved-row")).not.toBeInTheDocument()
	})
})
