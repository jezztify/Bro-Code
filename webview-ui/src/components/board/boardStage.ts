import type { BoardStage, BoardTask } from "@roo-code/types"

export interface BoardColumn {
	stage: BoardStage
	labelKey: string
	swatchClassName: string
}

// Order: Backlog -> Scoped -> Approved -> In Progress -> Done, using the same
// bg-vscode-charts-* swatch convention already used for todo status elsewhere.
export const COLUMNS: readonly BoardColumn[] = [
	{
		stage: "backlog",
		labelKey: "board:columns.backlog",
		swatchClassName: "bg-vscode-descriptionForeground",
	},
	{
		stage: "scoped",
		labelKey: "board:columns.scoped",
		swatchClassName: "bg-vscode-charts-blue",
	},
	{
		stage: "approved",
		labelKey: "board:columns.approved",
		swatchClassName: "bg-vscode-charts-purple",
	},
	{
		stage: "in_progress",
		labelKey: "board:columns.inProgress",
		swatchClassName: "bg-vscode-charts-yellow",
	},
	{
		stage: "done",
		labelKey: "board:columns.done",
		swatchClassName: "bg-vscode-charts-green",
	},
]

/**
 * Cards read top-down in the order they reached a column — a queue. Done is the
 * exception: it only grows, so the work that finished most recently is what a
 * reader wants at the top rather than buried under everything ever completed.
 * Position is the arrival order within a column, so reversing it is enough.
 */
export const compareBoardTasks =
	(stage: BoardStage) =>
	(a: BoardTask, b: BoardTask): number => {
		const arrivalOrder = a.position - b.position || a.createdAt - b.createdAt
		return stage === "done" ? -arrivalOrder : arrivalOrder
	}
