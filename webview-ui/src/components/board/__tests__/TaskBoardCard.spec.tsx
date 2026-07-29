import React from "react"

import type { BoardStage, BoardTask } from "@roo-code/types"

import { fireEvent, render, screen } from "@/utils/test-utils"
import { vscode } from "@/utils/vscode"

import { BOARD_TASK_MIME } from "../boardDrag"
import TaskBoardCard from "../TaskBoardCard"

vi.mock("@/utils/vscode")
vi.mock("@/i18n/TranslationContext", () => ({ useAppTranslation: () => ({ t: (key: string) => key }) }))

const now = Date.now()

const makeTask = (overrides: Partial<BoardTask> = {}): BoardTask => ({
	id: "task-1",
	workspaceId: "workspace-1",
	title: "Add dark mode",
	stage: "backlog",
	position: 0,
	createdAt: now,
	updatedAt: now,
	...overrides,
})

const renderCard = (overrides: Partial<BoardTask> = {}) => render(<TaskBoardCard task={makeTask(overrides)} />)

const primaryButton = (labelKey: string) => screen.getByRole("button", { name: labelKey })

describe("TaskBoardCard primary action", () => {
	beforeEach(() => vi.clearAllMocks())

	it.each([
		["backlog", "board:actions.refine", "refineBoardTask"],
		["scoped", "board:actions.approve", "approveBoardTask"],
		["approved", "board:actions.start", "startBoardTask"],
		["in_progress", "board:actions.stop", "stopBoardTask"],
	])("shows %s cards a %s button that posts %s", (stage, labelKey, messageType) => {
		renderCard({ stage: stage as BoardStage })

		fireEvent.click(primaryButton(labelKey))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: messageType, taskId: "task-1" })
	})

	it("shows done cards an open action that reveals the linked execution chat", () => {
		renderCard({ stage: "done", linkedHistoryTaskId: "execution-1" })

		fireEvent.click(primaryButton("board:actions.open"))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "showTaskWithId", text: "execution-1" })
	})

	it("disables the open action on a done card that was never run", () => {
		renderCard({ stage: "done" })

		expect(primaryButton("board:actions.open")).toBeDisabled()
	})

	it("requires a title before a card can be refined", () => {
		renderCard({ title: "   " })

		expect(primaryButton("board:actions.refine")).toBeDisabled()
	})

	it("keeps stop enabled on an untitled in-progress card so a run is always cancellable", () => {
		renderCard({ title: "", stage: "in_progress", linkedHistoryTaskId: "execution-1" })

		expect(primaryButton("board:actions.stop")).toBeEnabled()
	})

	it("identifies the card by its TASK number", () => {
		renderCard({ number: 142 })

		expect(screen.getByTestId("board-task-number-task-1")).toHaveTextContent("TASK-142")
	})

	it("shows no identifier on a card that has not been numbered yet", () => {
		renderCard()

		expect(screen.queryByTestId("board-task-number-task-1")).not.toBeInTheDocument()
	})

	it("opens the card's chat in the dock when the card is clicked", () => {
		renderCard({ stage: "in_progress", linkedHistoryTaskId: "execution-1" })

		fireEvent.click(screen.getByTestId("board-task-item-task-1"))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "showTaskWithId", text: "execution-1" })
	})

	it("opens the refinement chat while a card has no execution run yet", () => {
		renderCard({ stage: "scoped", linkedRefinementTaskId: "refine-1" })

		fireEvent.click(screen.getByTestId("board-task-item-task-1"))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "showTaskWithId", text: "refine-1" })
	})

	it("prefers the execution chat once a refined card has been started", () => {
		renderCard({ stage: "done", linkedRefinementTaskId: "refine-1", linkedHistoryTaskId: "execution-1" })

		fireEvent.click(screen.getByTestId("board-task-item-task-1"))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "showTaskWithId", text: "execution-1" })
	})

	it("opens nothing when a card has no conversation yet", () => {
		renderCard()

		fireEvent.click(screen.getByTestId("board-task-item-task-1"))

		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	it("leaves clicks on the card's own fields and buttons to those controls", () => {
		renderCard({ stage: "in_progress", linkedHistoryTaskId: "execution-1", number: 142 })

		fireEvent.click(screen.getByLabelText("Task title"))
		fireEvent.click(screen.getByLabelText("Task description"))

		expect(vscode.postMessage).not.toHaveBeenCalled()

		fireEvent.click(primaryButton("board:actions.stop"))

		expect(vscode.postMessage).toHaveBeenCalledTimes(1)
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "stopBoardTask", taskId: "task-1" })
	})

	it("opens the chat from the TASK number, so it is reachable by keyboard", () => {
		renderCard({ number: 142, linkedRefinementTaskId: "refine-1" })

		fireEvent.click(screen.getByRole("button", { name: "Open TASK-142 chat" }))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "showTaskWithId", text: "refine-1" })
	})

	it("leaves mode selection to the column rather than the card", () => {
		renderCard()

		expect(screen.queryByLabelText("Assigned mode")).not.toBeInTheDocument()
	})

	it("closes the card from the task board", () => {
		renderCard()

		fireEvent.click(screen.getByRole("button", { name: "Close task" }))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "deleteBoardTask", taskId: "task-1" })
	})

	it("still edits the card inline rather than opening a chat", () => {
		renderCard()

		fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Add dark mode toggle" } })
		fireEvent.blur(screen.getByLabelText("Task title"))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updateBoardTask",
			taskId: "task-1",
			boardTask: { title: "Add dark mode toggle", description: "" },
		})
	})
})

describe("TaskBoardCard dragging", () => {
	beforeEach(() => vi.clearAllMocks())

	const card = () => screen.getByTestId("board-task-item-task-1")

	it("moves stage by dragging rather than by a dropdown", () => {
		renderCard()

		expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
		expect(card()).toHaveAttribute("draggable", "true")
	})

	it("carries the card's id and current stage to the drop target", () => {
		renderCard({ stage: "scoped" })
		const dataTransfer = { effectAllowed: "none", setData: vi.fn() }

		fireEvent.dragStart(card(), { dataTransfer })

		expect(dataTransfer.effectAllowed).toBe("move")
		expect(dataTransfer.setData).toHaveBeenCalledWith(
			BOARD_TASK_MIME,
			JSON.stringify({ taskId: "task-1", stage: "scoped" }),
		)
	})

	it("stops being draggable while a field is focused so its text stays selectable", () => {
		renderCard()

		fireEvent.focus(screen.getByLabelText("Task description"))

		expect(card()).toHaveAttribute("draggable", "false")
	})

	it("becomes draggable again once editing ends", () => {
		renderCard()

		fireEvent.focus(screen.getByLabelText("Task title"))
		fireEvent.blur(screen.getByLabelText("Task title"))

		expect(card()).toHaveAttribute("draggable", "true")
	})
})
