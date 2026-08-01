import React from "react"

import { fireEvent, render, screen, within } from "@/utils/test-utils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"

import TaskBoardView from "../TaskBoardView"

vi.mock("@/context/ExtensionStateContext")
vi.mock("@/utils/vscode")
vi.mock("@/i18n/TranslationContext", () => ({ useAppTranslation: () => ({ t: (key: string) => key }) }))
vi.mock("@/components/ui/select", () => ({
	Select: ({ children }: any) => <div>{children}</div>,
	SelectTrigger: ({ children }: any) => <button type="button">{children}</button>,
	SelectValue: () => null,
	SelectContent: ({ children }: any) => <div>{children}</div>,
	SelectItem: ({ children }: any) => <div>{children}</div>,
}))

const now = Date.now()
const workspace = { id: "workspace-1", name: "Planning", createdAt: now, updatedAt: now }

const renderBoard = (overrides: Record<string, unknown> = {}) => {
	;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
		boardState: {
			version: 1,
			selectedWorkspaceId: workspace.id,
			workspaces: [workspace],
			tasks: [],
			migrations: {},
		},
		...overrides,
	})
	return render(<TaskBoardView />)
}

describe("workspace-first TaskBoardView", () => {
	beforeEach(() => vi.clearAllMocks())

	it("does not render a Chat button", () => {
		renderBoard()

		expect(screen.queryByRole("button", { name: "Chat" })).not.toBeInTheDocument()
	})

	it("validates work between in progress and done", () => {
		renderBoard()

		const columns = screen
			.getAllByTestId(/^board-column-/)
			.map((column) => column.getAttribute("data-testid")?.replace("board-column-", ""))

		expect(columns).toEqual(["backlog", "scoped", "approved", "in_progress", "qa_validation", "done"])
	})

	it("renders blank cards in their assigned stage", () => {
		renderBoard({
			boardState: {
				version: 1,
				selectedWorkspaceId: workspace.id,
				workspaces: [workspace],
				migrations: {},
				tasks: [
					{
						id: "blank",
						workspaceId: workspace.id,
						title: "",
						stage: "approved",
						position: 0,
						createdAt: now,
						updatedAt: now,
					},
				],
			},
		})
		const column = screen.getByTestId("board-column-approved")
		expect(within(column).getByPlaceholderText("Untitled task")).toBeInTheDocument()
		expect(within(column).getByRole("button", { name: "board:actions.start" })).toBeDisabled()
	})

	it("puts the most recently finished card at the top of done, and keeps other columns in arrival order", () => {
		const card = (id: string, stage: string, position: number) => ({
			id,
			workspaceId: workspace.id,
			title: id,
			stage,
			position,
			createdAt: now,
			updatedAt: now,
		})
		renderBoard({
			boardState: {
				version: 1,
				selectedWorkspaceId: workspace.id,
				workspaces: [workspace],
				migrations: {},
				tasks: [
					card("done-first", "done", 0),
					card("done-latest", "done", 2),
					card("done-second", "done", 1),
					card("backlog-first", "backlog", 0),
					card("backlog-second", "backlog", 1),
				],
			},
		})

		const titles = (stage: string) =>
			within(screen.getByTestId(`board-column-${stage}`))
				.getAllByLabelText("Task title")
				.map((input) => (input as HTMLInputElement).value)

		expect(titles("done")).toEqual(["done-latest", "done-second", "done-first"])
		expect(titles("backlog")).toEqual(["backlog-first", "backlog-second"])
	})

	it("collapses a long card description without changing its content", () => {
		const description = "Long description. ".repeat(20)
		renderBoard({
			boardState: {
				version: 1,
				selectedWorkspaceId: workspace.id,
				workspaces: [workspace],
				migrations: {},
				tasks: [
					{
						id: "long-description",
						workspaceId: workspace.id,
						title: "Long task",
						description,
						stage: "backlog",
						position: 0,
						createdAt: now,
						updatedAt: now,
					},
				],
			},
		})

		const textarea = screen.getByLabelText("Task description")
		expect(textarea).toHaveValue(description)
		expect(textarea).toHaveClass("h-16")
		fireEvent.click(screen.getByRole("button", { name: "Show full description" }))
		expect(textarea).toHaveClass("min-h-32")
		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	it("posts approval only after the plan is ready", () => {
		renderBoard({
			boardPlanning: {
				id: "plan-1",
				workspaceId: workspace.id,
				approvalRequired: true,
				approved: false,
				assistantText: "Proposed work",
				status: "awaiting_approval",
			},
		})
		fireEvent.click(screen.getByRole("button", { name: "Approve plan and add cards" }))
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "approveBoardPlanning" })
	})

	it("totals the workspace's tokens, subtasks included, regardless of the search filter", () => {
		const card = (id: string, linkedHistoryTaskId: string) => ({
			id,
			workspaceId: workspace.id,
			title: id,
			stage: "done",
			position: 0,
			createdAt: now,
			updatedAt: now,
			linkedHistoryTaskId,
		})
		const item = (id: string, tokensIn: number, tokensOut: number, childIds?: string[]) => ({
			id,
			number: 1,
			ts: now,
			task: id,
			tokensIn,
			tokensOut,
			totalCost: 0,
			childIds,
		})
		renderBoard({
			boardState: {
				version: 1,
				selectedWorkspaceId: workspace.id,
				workspaces: [workspace],
				migrations: {},
				tasks: [card("shipped", "run-1"), card("hidden-by-search", "run-2")],
			},
			taskHistory: [item("run-1", 1000, 100, ["child-1"]), item("child-1", 500, 50), item("run-2", 2000, 200)],
		})

		fireEvent.input(screen.getByPlaceholderText("board:searchPlaceholder"), { target: { value: "shipped" } })

		// The "k" suffix comes from i18next, which is not wired up in this suite.
		const totals = screen.getByTestId("board-workspace-tokens")
		expect(totals).toHaveTextContent("↑ 3.5")
		expect(totals).toHaveTextContent("↓ 350")
	})

	it("shows zero totals for a workspace whose cards have not run", () => {
		renderBoard()

		expect(screen.getByTestId("board-workspace-tokens")).toHaveTextContent("↑ 0")
	})

	it("does not render workspace rename or folder link controls", () => {
		renderBoard({
			boardState: {
				version: 1,
				selectedWorkspaceId: workspace.id,
				workspaces: [{ ...workspace, linkedWorkspacePath: "/workspace-a" }],
				tasks: [],
				migrations: {},
			},
		})

		expect(screen.queryByRole("button", { name: "Rename" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Change folder" })).not.toBeInTheDocument()
	})

	describe("creating workspaces", () => {
		it("creates the first workspace from the empty state", () => {
			renderBoard({
				boardState: { version: 1, workspaces: [], tasks: [], migrations: {} },
			})

			fireEvent.input(screen.getByLabelText("Workspace name"), { target: { value: "Planning" } })
			fireEvent.input(screen.getByLabelText("Workspace folder path"), { target: { value: "/repo/zoo" } })
			fireEvent.click(screen.getByRole("button", { name: "Create workspace" }))

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "createBoardWorkspace",
				workspaceName: "Planning",
				linkedWorkspacePath: "/repo/zoo",
			})
		})

		it("creates a further workspace from the board header", () => {
			renderBoard()
			// The create form is hidden until the header action is used.
			expect(screen.queryByLabelText("Workspace name")).not.toBeInTheDocument()

			fireEvent.click(screen.getByRole("button", { name: /New workspace/ }))
			fireEvent.input(screen.getByLabelText("Workspace name"), { target: { value: "Second board" } })
			fireEvent.click(screen.getByRole("button", { name: "Create workspace" }))

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "createBoardWorkspace",
				workspaceName: "Second board",
				linkedWorkspacePath: undefined,
			})
		})

		it("closes the header form once a workspace is created", () => {
			renderBoard()
			fireEvent.click(screen.getByRole("button", { name: /New workspace/ }))
			fireEvent.input(screen.getByLabelText("Workspace name"), { target: { value: "Second board" } })
			fireEvent.click(screen.getByRole("button", { name: "Create workspace" }))

			expect(screen.queryByLabelText("Workspace name")).not.toBeInTheDocument()
		})

		it("cancels the header form without creating anything", () => {
			renderBoard()
			fireEvent.click(screen.getByRole("button", { name: /New workspace/ }))
			fireEvent.input(screen.getByLabelText("Workspace name"), { target: { value: "Discarded" } })

			fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

			expect(screen.queryByLabelText("Workspace name")).not.toBeInTheDocument()
			expect(vscode.postMessage).not.toHaveBeenCalledWith(
				expect.objectContaining({ type: "createBoardWorkspace" }),
			)
		})

		it("requires a name before a workspace can be created", () => {
			renderBoard()
			fireEvent.click(screen.getByRole("button", { name: /New workspace/ }))

			expect(screen.getByRole("button", { name: "Create workspace" })).toBeDisabled()

			fireEvent.input(screen.getByLabelText("Workspace name"), { target: { value: "   " } })
			expect(screen.getByRole("button", { name: "Create workspace" })).toBeDisabled()
		})
	})
})
