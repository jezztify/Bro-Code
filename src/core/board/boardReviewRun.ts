import type { BoardState } from "@roo-code/types"

/**
 * The board's two read-only runs. A card's refinement chat turns an idea into a scoped
 * card; its validation chat checks a finished implementation against that card. Neither
 * is meant to touch the workspace — refinement happens before the user has approved
 * anything, and fixing what validation finds is the next execution run's job.
 */
export type BoardReviewRun = "refine" | "validate"

/**
 * Which of the board's read-only runs a conversation is, or undefined for anything else
 * — including a card's execution run, which is the one that *is* meant to write.
 *
 * Read off the board rather than remembered on the task, so it survives a window reload:
 * the link from card to conversation is what makes this run what it is, and that link is
 * already persisted.
 */
export const boardReviewRunFor = (state: BoardState, conversationId: string): BoardReviewRun | undefined => {
	for (const card of state.tasks) {
		if (card.linkedRefinementTaskId === conversationId) return "refine"
		if (card.linkedValidationTaskId === conversationId) return "validate"
	}
	return undefined
}

/** The narrow view of a live conversation this needs, so the rule can be exercised without a `Task`. */
type BoardReviewConversation = {
	taskId: string
	providerRef?: { deref(): { boardStore?: { getSnapshot(): BoardState } } | undefined }
}

/**
 * Whether the model driving this conversation is pinned to the mode the run started in.
 *
 * A board review run is launched in a mode that cannot write — `board-refine`,
 * `board-qa`, or whatever read-only mode the card's column carries — and its opening
 * message tells it in as many words not to touch product code. Neither holds on its own.
 * A mode's `groups` are the only thing that actually stops an edit, and `switch_mode`,
 * `new_task` and `run_slash_command` sit in `ALWAYS_AVAILABLE_TOOLS`, so they are offered
 * whatever the mode says. A refiner that decides the card would be easier to scope if it
 * just built the thing can walk itself into `code` and do exactly that.
 *
 * It can also hand the exit to the user without either of them noticing, because
 * `ask_followup_question` suggestions carry an optional mode: answering a scoping
 * question by clicking a suggestion then doubles as a mode switch nobody asked for, and
 * the run that comes back is holding edit tools.
 *
 * So the model is pinned. The user is not — the mode dropdown still works, because
 * taking a refinement chat over by hand is a deliberate act, and the only way to decide
 * a card is better implemented than discussed.
 */
export const lockedBoardReviewRun = (task: BoardReviewConversation): BoardReviewRun | undefined => {
	// A conversation that has outlived its provider cannot be identified either way, and
	// deciding on a guess is worse than not deciding: throwing here would take down every
	// tool that asks, and pinning here would strand a chat that is not the board's at all.
	const store = task.providerRef?.deref()?.boardStore
	return store ? boardReviewRunFor(store.getSnapshot(), task.taskId) : undefined
}

/** What this run should be doing instead of leaving its mode. */
const NEXT_STEP: Record<BoardReviewRun, string> = {
	refine: 'This card has not been approved for implementation yet. Finish refining it: agree the scope with the user, then write the sharpened title and description back with `update_board_task` and set `stage` to `"scoped"`. The card is implemented later, in its own run.',
	validate:
		'Fixing what you find is not this run\'s job. Finish the check and report it: append your findings to the card with `update_board_task`, set `stage` to `"in_progress"`, then call `attempt_completion`.',
}

const RUN_NAME: Record<BoardReviewRun, string> = {
	refine: "refinement",
	validate: "QA validation",
}

/** What the model is told when it tries to leave the mode its board column assigned it. */
export const boardReviewRunRefusal = (run: BoardReviewRun, tool: string): string =>
	`\`${tool}\` is not available in a board ${RUN_NAME[run]} run — it stays in the mode its board column assigned it. ${NEXT_STEP[run]}`

/**
 * The tools that would let a pinned run out of its mode, withheld from the list the
 * model is offered so it does not spend turns discovering they are refused. Both are in
 * `ALWAYS_AVAILABLE_TOOLS`, so a mode's own groups cannot withhold them.
 */
export const BOARD_REVIEW_RUN_WITHHELD_TOOLS = ["switch_mode", "new_task"] as const
