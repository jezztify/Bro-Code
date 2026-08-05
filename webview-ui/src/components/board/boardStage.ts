import type { BoardStage } from "@roo-code/types"

// Defined alongside the board schema so the manager running in the extension host
// works each column in the same order this board paints it.
export { compareBoardTasks } from "@roo-code/types"

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
export const STAGE_LABEL_KEYS = Object.fromEntries(COLUMNS.map((column) => [column.stage, column.labelKey])) as Record<
	BoardStage,
	string
>
