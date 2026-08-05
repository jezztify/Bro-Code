import React from "react"

import type { BoardManager, BoardStage, BoardTask } from "@roo-code/types"

import { fireEvent, render, screen } from "@/utils/test-utils"
import { vscode } from "@/utils/vscode"

import BoardManagerCard from "../BoardManagerCard"

vi.mock("@/utils/vscode")
vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) =>
			key === "board:manager.inFlight" ? `${options?.active} of ${options?.limit} in progress` : key,
	}),
}))

// Two pickers are on screen, so their handlers are captured in render order:
// mode first, then API configuration.
let handlers: Array<(value: string) => void> = []
vi.mock("@/components/ui/select", () => ({
	Select: ({ children, onValueChange }: any) => {
		handlers.push(onValueChange)
		return <div>{children}</div>
	},
	SelectTrigger: ({ children, ...props }: any) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
	SelectValue: () => null,
	SelectContent: ({ children }: any) => <div>{children}</div>,
	SelectItem: ({ children }: any) => <div>{children}</div>,
}))

const card = (stage: BoardStage, id = stage): BoardTask => ({
	id,
	workspaceId: "workspace-1",
	title: `Card ${id}`,
	stage,
	position: 0,
	createdAt: 0,
	updatedAt: 0,
})

const renderCard = (manager?: BoardManager, tasks: BoardTask[] = []) =>
	render(
		<BoardManagerCard
			workspaceId="workspace-1"
			manager={manager}
			tasks={tasks}
			customModes={[]}
			apiConfigs={[{ id: "cfg-1", name: "Sonnet" }]}
		/>,
	)

describe("BoardManagerCard", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		handlers = []
	})

	it("starts the manager without disturbing the mode and profile it was given", () => {
		renderCard({ enabled: false, mode: "architect", apiConfigName: "Sonnet" })

		fireEvent.click(screen.getByRole("button", { name: "board:manager.start" }))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "setBoardManager",
			workspaceId: "workspace-1",
			boardManager: { enabled: true },
		})
	})

	it("stops a running manager", () => {
		renderCard({ enabled: true })

		fireEvent.click(screen.getByRole("button", { name: "board:manager.stop" }))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "setBoardManager",
			workspaceId: "workspace-1",
			boardManager: { enabled: false },
		})
	})

	it("assigns a mode to manager-run tasks", () => {
		renderCard({ enabled: false })

		handlers[0]("architect")

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "setBoardManager",
			workspaceId: "workspace-1",
			boardManager: { mode: "architect" },
		})
	})

	it("clears the mode back to the columns' own", () => {
		renderCard({ enabled: false, mode: "architect" })

		handlers[0]("__use_column_mode__")

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "setBoardManager",
			workspaceId: "workspace-1",
			boardManager: { mode: null },
		})
	})

	it("assigns an API configuration to manager-run tasks", () => {
		renderCard({ enabled: false })

		handlers[1]("Sonnet")

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "setBoardManager",
			workspaceId: "workspace-1",
			boardManager: { apiConfigName: "Sonnet" },
		})
	})

	it("counts only the cards actually being worked on", () => {
		renderCard({ enabled: true }, [card("backlog"), card("approved"), card("in_progress"), card("done")])

		expect(screen.getByText("1 of 1 in progress")).toBeInTheDocument()
	})

	it("counts a card in validation as still being worked on", () => {
		renderCard({ enabled: true }, [card("qa_validation")])

		expect(screen.getByText("1 of 1 in progress")).toBeInTheDocument()
	})

	it("reads as stopped when the workspace has never had a manager", () => {
		renderCard(undefined)

		expect(screen.getByTestId("board-manager-status").textContent).toBe("board:manager.stopped")
	})
})
