import type { BoardStage } from "@roo-code/types"

/**
 * Custom MIME type for a card drag, so a column highlights and accepts only cards
 * dragged from this board and ignores unrelated drags (files, editor text, links)
 * that happen to pass over it.
 */
export const BOARD_TASK_MIME = "application/x-zoo-board-task"

/**
 * The dragged card's stage travels with it so the drop target can tell a real
 * column change from a drop back into the column the card came from — the latter
 * is a no-op rather than an update that would send the card to the column's end.
 */
export interface BoardTaskDragPayload {
	taskId: string
	stage: BoardStage
}

export const writeBoardTaskDrag = (dataTransfer: DataTransfer, payload: BoardTaskDragPayload) => {
	dataTransfer.effectAllowed = "move"
	dataTransfer.setData(BOARD_TASK_MIME, JSON.stringify(payload))
}

/**
 * During dragover the payload itself is unreadable (the browser puts the drag data
 * store in protected mode), so the MIME type is all a column has to decide whether
 * it is a valid drop target.
 */
export const hasBoardTaskDrag = (dataTransfer: DataTransfer | null) =>
	Array.from(dataTransfer?.types ?? []).includes(BOARD_TASK_MIME)

export const readBoardTaskDrag = (dataTransfer: DataTransfer | null): BoardTaskDragPayload | undefined => {
	const raw = dataTransfer?.getData(BOARD_TASK_MIME)
	if (!raw) return undefined
	try {
		const payload = JSON.parse(raw)
		return typeof payload?.taskId === "string" && typeof payload?.stage === "string" ? payload : undefined
	} catch {
		return undefined
	}
}
