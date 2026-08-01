import React from "react"

import { fireEvent, render, screen } from "@/utils/test-utils"
import { vscode } from "@/utils/vscode"

import { BOARD_TASK_MIME } from "../boardDrag"
import { COLUMNS } from "../boardStage"
import TaskBoardColumn from "../TaskBoardColumn"

vi.mock("@/utils/vscode")
vi.mock("@/i18n/TranslationContext", () => ({ useAppTranslation: () => ({ t: (key: string) => key }) }))

// The column is rendered without cards, so the only Select on screen is the
// column's mode picker and its handler is unambiguous.
let onValueChange: ((value: string) => void) | undefined
vi.mock("@/components/ui/select", () => ({
	Select: ({ children, onValueChange: handler }: any) => {
		onValueChange = handler
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

const approved = COLUMNS.find((column) => column.stage === "approved")!

const renderColumn = (mode?: string) =>
	render(
		<TaskBoardColumn
			column={approved}
			tasks={[]}
			workspaceId="workspace-1"
			customModes={[]}
			mode={mode}
			runningTaskIds={new Set()}
		/>,
	)

describe("TaskBoardColumn mode", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		onValueChange = undefined
	})

	it("assigns a mode to the whole column", () => {
		renderColumn()

		onValueChange!("code")

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "setBoardColumnMode",
			workspaceId: "workspace-1",
			stage: "approved",
			mode: "code",
		})
	})

	it("clears the column back to the current mode", () => {
		renderColumn("code")

		onValueChange!("__use_current_mode__")

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "setBoardColumnMode",
			workspaceId: "workspace-1",
			stage: "approved",
			mode: undefined,
		})
	})

	it("keeps a deleted mode visible instead of reading as unassigned", () => {
		renderColumn("removed-mode")

		expect(screen.getByText("Unavailable: removed-mode")).toBeInTheDocument()
	})

	it("labels the picker with its column", () => {
		renderColumn()

		expect(screen.getByLabelText(`Mode for ${approved.labelKey}`)).toBeInTheDocument()
	})
})

describe("TaskBoardColumn running state", () => {
	beforeEach(() => vi.clearAllMocks())

	const inProgress = COLUMNS.find((column) => column.stage === "in_progress")!
	const now = Date.now()
	const card = {
		id: "task-1",
		workspaceId: "workspace-1",
		title: "Add dark mode",
		stage: "in_progress" as const,
		position: 0,
		createdAt: now,
		updatedAt: now,
		linkedHistoryTaskId: "execution-1",
	}

	const renderInProgress = (runningTaskIds: Set<string>) =>
		render(
			<TaskBoardColumn
				column={inProgress}
				tasks={[card]}
				workspaceId="workspace-1"
				customModes={[]}
				runningTaskIds={runningTaskIds}
			/>,
		)

	it("offers stop while the card's execution task is live", () => {
		renderInProgress(new Set(["execution-1"]))

		expect(screen.getByRole("button", { name: "board:actions.stop" })).toBeInTheDocument()
	})

	it("offers start once the card's execution task is gone", () => {
		renderInProgress(new Set(["some-other-task"]))

		expect(screen.getByRole("button", { name: "board:actions.start" })).toBeInTheDocument()
	})
})

describe("TaskBoardColumn as a drop target", () => {
	beforeEach(() => vi.clearAllMocks())

	const dropped = (stage: string) => ({
		types: [BOARD_TASK_MIME],
		getData: (type: string) => (type === BOARD_TASK_MIME ? JSON.stringify({ taskId: "task-1", stage }) : ""),
	})

	const column = () => screen.getByTestId(`board-column-${approved.stage}`)

	it("moves a card dropped from another column into this stage", () => {
		renderColumn()

		fireEvent.drop(column(), { dataTransfer: dropped("backlog") })

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updateBoardTask",
			taskId: "task-1",
			boardTask: { stage: "approved" },
		})
	})

	it("leaves a card dropped back into its own column alone rather than resetting its position", () => {
		renderColumn()

		fireEvent.drop(column(), { dataTransfer: dropped("approved") })

		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	it("ignores drops that are not board cards", () => {
		renderColumn()

		fireEvent.drop(column(), { dataTransfer: { types: ["Files"], getData: () => "" } })

		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	// A dragover is "accepted" by calling preventDefault, which dispatchEvent reports
	// back as false; without it the browser never fires a drop at all.
	const dragOver = (types: string[]) => !fireEvent.dragOver(column(), { dataTransfer: { types, dropEffect: "none" } })

	it("accepts the drag only while a board card is over it", () => {
		renderColumn()

		expect(dragOver(["Files"])).toBe(false)
		expect(dragOver([BOARD_TASK_MIME])).toBe(true)
	})
})
