import React from "react"
import { render, screen } from "@/utils/test-utils"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { ChatRowContent } from "../ChatRow"

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
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

const renderRow = (type: "ask", tool: Record<string, unknown>) =>
	render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ChatRowContent
					message={
						{
							type,
							...(type === "ask" ? { ask: "tool" } : { say: "tool" }),
							ts: Date.now(),
							text: JSON.stringify(tool),
							partial: false,
						} as never
					}
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
