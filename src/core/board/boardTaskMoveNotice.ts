import type { BoardTask, ClineSay } from "@roo-code/types"

import { readTaskMessages, saveTaskMessages } from "../task-persistence"

import type { BoardTaskMove } from "./BoardStore"

export const BOARD_TASK_MOVED_SAY: ClineSay = "board_task_moved"

/**
 * The conversation a note about a card belongs in: the card's latest one, which is
 * also the one clicking the card opens. Validation once the card has been checked,
 * otherwise the execution run, and before either of those the refinement chat is the
 * only conversation the card has. A card that has started none has nowhere to be
 * told anything yet.
 */
export const boardTaskChatId = (task: BoardTask): string | undefined =>
	task.linkedValidationTaskId ?? task.linkedHistoryTaskId ?? task.linkedRefinementTaskId

/** A conversation that is live in this host and owns its own copy of its messages. */
export type LiveConversation = {
	say: (type: ClineSay, text: string) => Promise<unknown>
}

/**
 * Leave a note in a moved card's conversation, so a move - dragged by the user, made
 * by the model, or made by the pipeline while nobody was watching the board - is
 * visible where the work is actually discussed.
 *
 * The columns travel as data rather than as a finished sentence: the webview names
 * them exactly as the board's own column headers do, in the reader's language.
 */
export async function postBoardTaskMoveNotice(
	move: BoardTaskMove,
	findLiveConversation: (taskId: string) => LiveConversation | undefined,
): Promise<void> {
	const chatTaskId = boardTaskChatId(move.task)
	if (!chatTaskId) return

	const text = JSON.stringify({ from: move.from, to: move.to })

	// A live conversation holds its messages in memory: appending to the file behind
	// its back would miss the open chat view and be overwritten by its next save.
	const liveConversation = findLiveConversation(chatTaskId)
	if (liveConversation) {
		await liveConversation.say(BOARD_TASK_MOVED_SAY, text)
		return
	}

	const globalStoragePath = move.globalStoragePath
	const messages = await readTaskMessages({ taskId: chatTaskId, globalStoragePath })
	messages.push({ type: "say", say: BOARD_TASK_MOVED_SAY, text, ts: Date.now() })
	await saveTaskMessages({ messages, taskId: chatTaskId, globalStoragePath })
}
