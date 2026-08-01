import type { BoardStage, BoardTask } from "@roo-code/types"

export interface BoardColumn {
	stage: BoardStage
	labelKey: string
	swatchClassName: string
}

// Order: Backlog -> Scoped -> Approved -> In Progress -> QA Validation -> Done,
// using the same bg-vscode-charts-* swatch convention already used for todo status
// elsewhere.
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
		stage: "qa_validation",
		labelKey: "board:columns.qaValidation",
		swatchClassName: "bg-vscode-charts-orange",
	},
	{
		stage: "done",
		labelKey: "board:columns.done",
		swatchClassName: "bg-vscode-charts-green",
	},
]

/**
 * A column's heading, keyed by stage, so a stage can be named away from its column —
 * a card describing the move that brought it here calls its columns what the board
 * calls them.
 */
export const STAGE_LABEL_KEYS = Object.fromEntries(
	COLUMNS.map((column) => [column.stage, column.labelKey]),
) as Record<BoardStage, string>

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
