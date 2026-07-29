import type { BoardTask, HistoryItem } from "@roo-code/types"

export type BoardTokenTotals = {
	tokensIn: number
	tokensOut: number
}

/**
 * Every token a workspace has spent: each of its cards' refinement and execution
 * chats, plus everything those chats delegated to, however deep. A subtask's
 * tokens are spent on its parent card's behalf, so the workspace total follows
 * `childIds` rather than stopping at the conversations the cards link to
 * directly - the same traversal the chat header's aggregated totals use.
 */
export const sumBoardWorkspaceTokens = (
	tasks: BoardTask[],
	history: HistoryItem[],
	workspaceId: string,
): BoardTokenTotals => {
	const historyById = new Map(history.map((item) => [item.id, item]))
	const pending = tasks
		.filter((task) => task.workspaceId === workspaceId)
		.flatMap((task) => [task.linkedRefinementTaskId, task.linkedHistoryTaskId])
		.filter((id): id is string => !!id)
	// A task reachable from more than one card (or from a cycle) was still only
	// paid for once, so each id contributes at most once to the total.
	const counted = new Set<string>()
	let tokensIn = 0
	let tokensOut = 0

	while (pending.length > 0) {
		const id = pending.pop()!
		if (counted.has(id)) continue
		counted.add(id)
		const item = historyById.get(id)
		if (!item) continue
		tokensIn += item.tokensIn || 0
		tokensOut += item.tokensOut || 0
		if (item.childIds?.length) pending.push(...item.childIds)
	}

	return { tokensIn, tokensOut }
}
