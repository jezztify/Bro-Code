import type { BoardStage, BoardState, BoardTask } from "@roo-code/types"
import {
	BOARD_ACTIVE_TASK_LIMIT,
	BOARD_MAX_REWORK_CYCLES,
	BOARD_QA_FINDINGS_HEADING,
	compareBoardTasks,
	formatBoardTaskNumber,
} from "@roo-code/types"

import type { BoardManagerLock } from "./BoardManagerLock"
import type { BoardStore } from "./BoardStore"

/**
 * What the manager does to a card. Each is one of the buttons the card already
 * offers, so the autopilot drives the board through exactly the same paths a
 * person clicking would.
 */
export type BoardManagerActionKind = "refine" | "start" | "validate" | "resume"

export type BoardManagerAction = {
	kind: BoardManagerActionKind
	task: BoardTask
	/**
	 * The column the card sits in for as long as this action is being carried out.
	 * Leaving it is what tells the manager the action is finished — the run itself
	 * cannot say so, because a conversation that has called `attempt_completion`
	 * stays parked on its result rather than ending.
	 */
	workingStage: BoardStage
	/** Why an existing conversation is being resumed, and so what it gets told. */
	reason?: BoardResumeReason
}

/**
 * Why a run is being picked back up. Held as a reason rather than as finished text
 * because what a blocked card needs to be told lives in another conversation, and
 * reading it is I/O — which would make choosing an action asynchronous.
 */
export type BoardResumeReason =
	| { kind: "continue" }
	/** Validation sent the card back. `validationTaskId` is the run that decided that. */
	| { kind: "fix"; validationTaskId?: string }

/**
 * The pieces of the extension host the manager drives. Kept to an interface so the
 * decision logic can be exercised without a `ClineProvider`, a webview, or a model.
 */
export type BoardManagerHost = {
	refineBoardTask(taskId: string, options?: BoardRunOptions): Promise<void>
	startBoardTask(taskId: string, options?: BoardRunOptions): Promise<void>
	validateBoardTask(taskId: string, options?: BoardRunOptions): Promise<void>
	resumeBoardTask(taskId: string, guidance: string, options?: BoardRunOptions): Promise<void>
	/**
	 * Whether a conversation is still doing something, as opposed to parked waiting to
	 * be told what to do next. A finished run is not gone — it holds its completion
	 * open — so "is it in the registry" would mean the manager waited forever.
	 */
	isConversationWorking(historyTaskId: string): boolean
	/**
	 * The result a conversation signed off with, or undefined if it never reached one.
	 * This is what a validation run's verdict actually says, as opposed to the summary
	 * it left behind on the card.
	 */
	readCompletionMessage(historyTaskId: string): Promise<string | undefined>
	log(message: string): void
}

/** How a manager-launched run differs from the same run started by hand. */
export type BoardRunOptions = {
	/** Used only where the card's column has no mode of its own. */
	fallbackMode?: string
	/** The provider profile the run uses. Columns carry no profile of their own. */
	apiConfigName?: string
}

/** A card the manager is waiting on, and how it will know the wait is over. */
type BoardManagerWait = {
	boardTaskId: string
	/** The column the card was in when the action was launched. */
	fromStage: BoardStage
	/** The column it occupies while the action runs. */
	workingStage: BoardStage
	/** The conversation the action launched or resumed, if it produced one. */
	historyTaskId?: string
}

/**
 * The conversation an action of this kind runs in, so a launched action can be
 * matched to the run it produced.
 */
const conversationFor = (task: BoardTask, kind: BoardManagerActionKind): string | undefined => {
	switch (kind) {
		case "refine":
			return task.linkedRefinementTaskId
		case "validate":
			return task.linkedValidationTaskId
		case "start":
		case "resume":
			return task.linkedHistoryTaskId
	}
}

/**
 * What to tell an execution run that is being picked back up.
 *
 * A blocked card is handed the validator's own sign-off rather than anything copied
 * off the card. The card only carries the summary the validator chose to write onto
 * it; the completion message is the verdict itself — per-criterion, with the code and
 * checks that decided each one — and the run that built the work has seen neither,
 * since both came after it started.
 */
export const buildBoardResumeGuidance = (reason: BoardResumeReason, verdict?: string): string => {
	if (reason.kind === "continue") {
		return "Continue this task. Pick up where you left off and finish it, then call `attempt_completion`."
	}

	return [
		"QA validation checked this work against the card's acceptance criteria and sent it back. Fix the found issues, then call `attempt_completion` so it can be validated again.",
		"",
		...(verdict?.trim()
			? ["## What the validator reported", "", verdict.trim()]
			: [
					// Its findings are on the card, but this run's opening message predates
					// them, so it has to go and look rather than scroll back.
					`The validator's report could not be read back. Read this card with \`read_board_tasks\` and work from its \`${BOARD_QA_FINDINGS_HEADING}\` section.`,
				]),
	].join("\n")
}

/**
 * Why a card sitting in In Progress is being picked back up. Read from the activity
 * log rather than inferred from the card, because a card validation sent back looks
 * exactly like one that was never validated.
 */
export const boardResumeReason = (state: BoardState, task: BoardTask): BoardResumeReason => {
	const last = (state.activity ?? []).filter((entry) => entry.taskId === task.id).at(-1)
	// The same move the log paints as BLOCKED: validation refusing to pass the card.
	return last?.outcome === "blocked" && last.from === "qa_validation" && last.to === "in_progress"
		? { kind: "fix", validationTaskId: task.linkedValidationTaskId }
		: { kind: "continue" }
}

/**
 * How many times validation has already sent this card back.
 *
 * Counted from the activity log rather than kept on the card, for the same reason the
 * resume reason is: the log is the only record of what happened to a card that
 * survives the run that caused it. Counting stops at the last time the card was reset
 * to approved, because stopping a card discards its run and its findings — what
 * follows is a fresh attempt and deserves a fresh budget.
 */
export const boardReworkCycleCount = (state: BoardState, task: BoardTask): number => {
	// `filter` hands back a fresh array, so reversing it in place costs nothing.
	const entries = (state.activity ?? []).filter((entry) => entry.taskId === task.id).reverse()
	let cycles = 0
	for (const entry of entries) {
		if (entry.to === "approved") break
		if (entry.from === "qa_validation" && entry.to === "in_progress") cycles += 1
	}
	return cycles
}

/**
 * The one thing the manager should do next for a workspace, or nothing when the
 * board is already busy, is waiting on the user, or has run out of work.
 *
 * Pure, and the whole of the manager's judgement: the columns are walked in the
 * order work drains — validation first, then implementation, then the queue of
 * approved cards, and only once nothing is in flight does refinement of the backlog
 * begin. Scoped is deliberately absent (the user decides what gets approved) and so
 * is done (nothing is left to do to a retired card).
 */
export const selectBoardManagerAction = (
	state: BoardState,
	workspaceId: string,
	context: {
		isConversationWorking: (historyTaskId: string) => boolean
		isSkipped: (boardTaskId: string) => boolean
	},
): BoardManagerAction | undefined => {
	const cards = state.tasks.filter((task) => task.workspaceId === workspaceId)
	const inColumn = (stage: BoardStage) => cards.filter((task) => task.stage === stage).sort(compareBoardTasks(stage))

	// The hard rule: while any card is being implemented or validated, the manager's
	// only job is to carry that one card through. Nothing new is picked up, whatever
	// is queued behind it.
	const active = [...inColumn("qa_validation"), ...inColumn("in_progress")]
	if (active.length >= BOARD_ACTIVE_TASK_LIMIT) {
		for (const task of active) {
			// Both of the card's runs are checked, whichever column it sits in. A
			// validator sending a card back moves it *before* it signs off, so for the
			// moment between the two the card is in In Progress with its validator still
			// writing — and resuming the implementation there would put two runs in the
			// same folder, which is the one thing the active limit exists to prevent.
			const conversations = [task.linkedValidationTaskId, task.linkedHistoryTaskId]
			// A run that is still working — including one waiting on a question the user
			// has been asked — is left alone. Interrupting it is not the manager's job.
			if (conversations.some((id) => id && context.isConversationWorking(id))) return undefined
			if (context.isSkipped(task.id)) continue
			if (!task.title.trim()) continue

			if (task.stage === "qa_validation") {
				return { kind: "validate", task, workingStage: "qa_validation" }
			}
			// A card dragged straight into In Progress has no run behind it yet, so it is
			// started rather than resumed.
			return task.linkedHistoryTaskId
				? { kind: "resume", task, workingStage: "in_progress", reason: boardResumeReason(state, task) }
				: { kind: "start", task, workingStage: "in_progress" }
		}
		// Everything in flight is either running, skipped, or unusable. Either way the
		// limit is spoken for and no new card may be pulled in.
		return undefined
	}

	for (const task of inColumn("approved")) {
		if (context.isSkipped(task.id) || !task.title.trim()) continue
		return { kind: "start", task, workingStage: "in_progress" }
	}

	for (const task of inColumn("backlog")) {
		if (context.isSkipped(task.id) || !task.title.trim()) continue
		// Refining a card that already has a refinement chat only reopens it, which
		// would leave the manager clicking forever. Those are the user's to carry on.
		if (task.linkedRefinementTaskId) continue
		return { kind: "refine", task, workingStage: "backlog" }
	}

	return undefined
}

/**
 * Walks cards from backlog to done without anyone clicking, by pressing the same
 * Refine / Start / Validate the cards already offer.
 *
 * One action at a time, host-wide: an action is launched, and nothing else happens
 * until the card it touched leaves the column that action works in. That is what
 * keeps two runs from editing the same folder at once, and it makes the "one card in
 * flight" rule fall out of the design rather than having to be policed.
 *
 * Deliberately holds no model of its own. Every decision above is a rule, so the
 * judgement stays where the work is — in the mode each column runs.
 */
export class BoardManager {
	private host?: BoardManagerHost
	private waiting?: BoardManagerWait
	private running = false
	/** A tick that arrived while one was already in progress, replayed after it. */
	private tickPending = false
	/**
	 * Cards whose last action ended without moving them. Kept per stage so a card the
	 * user rescues — by editing it, or dragging it somewhere else — is picked back up,
	 * while one left exactly as it was is not retried forever.
	 */
	private readonly skipped = new Map<string, BoardStage>()

	/**
	 * @param lock Which extension host may act on a board workspace. Optional so the
	 * rules can be exercised without a filesystem; production always passes one, and
	 * without it every open VS Code window drives the same cards.
	 */
	constructor(
		private readonly store: BoardStore,
		private readonly lock?: BoardManagerLock,
	) {}

	/**
	 * The provider that carries out actions. Static-ish by nature: a board can be open
	 * in the sidebar and in its own window at once, and the manager must act once, not
	 * once per window. Registering a second host replaces the first, the same way
	 * `BoardStore`'s move notifier does.
	 */
	setHost(host: BoardManagerHost | undefined): void {
		this.host = host
	}

	/**
	 * No surface left to act through. The claim is handed back rather than left to
	 * expire, so another VS Code window picks the board up the moment this one closes
	 * instead of waiting out the lease.
	 */
	async standDown(): Promise<void> {
		this.waiting = undefined
		this.skipped.clear()
		await this.lock?.retain(new Set())
	}

	/**
	 * Reconsider what to do. Cheap and safe to call on anything that could have changed
	 * the answer — every board write, and every task lifecycle transition.
	 */
	tick(): void {
		void this.run()
	}

	private async run(): Promise<void> {
		if (this.running) {
			// Whatever changed will still be true when the current pass finishes, so it
			// is replayed rather than raced.
			this.tickPending = true
			return
		}
		this.running = true
		try {
			do {
				this.tickPending = false
				await this.step()
			} while (this.tickPending)
		} finally {
			this.running = false
		}
	}

	private async step(): Promise<void> {
		const host = this.host
		if (!host) return

		const state = this.store.getSnapshot()
		const managed = state.workspaces.filter((workspace) => workspace.manager?.enabled)
		// Held only for as long as a board is switched on, so switching it off in one
		// window frees it for the next rather than making it wait out the lease.
		await this.lock?.retain(new Set(managed.map((workspace) => workspace.id)))
		if (managed.length === 0) {
			// Switched off, so nothing is being waited on and no card is written off.
			this.waiting = undefined
			this.skipped.clear()
			return
		}

		this.releaseFinishedCards(state, host)
		this.setAsideExhaustedCards(state, host, managed)
		if (this.waiting) return

		for (const workspace of managed) {
			// Every VS Code window runs its own manager over the same board, so acting
			// requires being the window that claimed this workspace. Without it two hosts
			// work the same card: the one that acts second has not seen the first's
			// execution link, reads the card as unstarted, and starts it a second time.
			if (this.lock && !(await this.lock.claim(workspace.id))) continue

			const action = selectBoardManagerAction(state, workspace.id, {
				isConversationWorking: (id) => host.isConversationWorking(id),
				isSkipped: (id) => this.skipped.has(id),
			})
			if (!action) continue

			// Claimed before the action runs: launching a task is slow enough that a board
			// change arriving mid-flight would otherwise start the same card twice.
			this.waiting = {
				boardTaskId: action.task.id,
				fromStage: action.task.stage,
				workingStage: action.workingStage,
			}
			const options: BoardRunOptions = {
				fallbackMode: workspace.manager?.mode,
				apiConfigName: workspace.manager?.apiConfigName,
			}
			await this.carryOut(host, action, options)
			return
		}
	}

	private async carryOut(
		host: BoardManagerHost,
		action: BoardManagerAction,
		options: BoardRunOptions,
	): Promise<void> {
		const reference = formatBoardTaskNumber(action.task.number) ?? action.task.id.slice(0, 8)
		try {
			switch (action.kind) {
				case "refine":
					await host.refineBoardTask(action.task.id, options)
					break
				case "start":
					await host.startBoardTask(action.task.id, options)
					break
				case "validate":
					await host.validateBoardTask(action.task.id, options)
					break
				case "resume": {
					const reason = action.reason ?? { kind: "continue" }
					// Read only for a blocked card, and only once it is actually being
					// resumed: choosing an action stays free of I/O.
					const verdict =
						reason.kind === "fix" && reason.validationTaskId
							? await host.readCompletionMessage(reason.validationTaskId)
							: undefined
					await host.resumeBoardTask(action.task.id, buildBoardResumeGuidance(reason, verdict), options)
					break
				}
			}
			host.log(`[BoardManager] ${action.kind} ${reference}`)
			// The conversation only exists once the action has run, and it is what tells
			// the next pass whether the card is being worked on or has stalled.
			const launched = this.store.getSnapshot().tasks.find((task) => task.id === action.task.id)
			if (this.waiting?.boardTaskId === action.task.id && launched) {
				this.waiting.historyTaskId = conversationFor(launched, action.kind)
			}
		} catch (error) {
			// An action that could not even start is not worth retrying on a loop: the
			// card is set aside and the rest of the board keeps moving.
			host.log(`[BoardManager] ${action.kind} ${reference} failed: ${String(error)}`)
			this.waiting = undefined
			this.skipped.set(action.task.id, action.task.stage)
			this.tickPending = true
		}
	}

	/**
	 * Stop picking up a card that validation keeps sending back.
	 *
	 * Ping-ponging between In Progress and QA Validation is the one stall the rest of
	 * the manager cannot see: a card set aside for stalling has to sit still to be
	 * noticed, and this card moves every time. Left alone the two runs will trade the
	 * card indefinitely, each spending a full model run to reach the same disagreement,
	 * so after {@link BOARD_MAX_REWORK_CYCLES} the card is set aside for the user. Doing
	 * it through `skipped` means the ordinary rescue applies: edit the card or drag it
	 * somewhere, and the manager picks it up again.
	 */
	private setAsideExhaustedCards(state: BoardState, host: BoardManagerHost, managed: BoardState["workspaces"]): void {
		const managedIds = new Set(managed.map((workspace) => workspace.id))
		for (const task of state.tasks) {
			if (task.stage !== "in_progress" || !managedIds.has(task.workspaceId)) continue
			if (this.skipped.has(task.id)) continue
			if (boardReworkCycleCount(state, task) < BOARD_MAX_REWORK_CYCLES) continue

			host.log(
				`[BoardManager] ${formatBoardTaskNumber(task.number) ?? task.id.slice(0, 8)} has been sent back by validation ${BOARD_MAX_REWORK_CYCLES} times; setting it aside for you`,
			)
			this.skipped.set(task.id, task.stage)
			// A card claimed for an action that is now written off must not also be
			// waited on, or the board sits still until something else moves.
			if (this.waiting?.boardTaskId === task.id) this.waiting = undefined
		}
	}

	/**
	 * Decide whether the card being waited on is still being worked on. A card that has
	 * left the column its action works in has finished it; one still sitting there with
	 * nothing running behind it has stalled, and is set aside so the board can move on.
	 */
	private releaseFinishedCards(state: BoardState, host: BoardManagerHost): void {
		for (const [taskId, stage] of this.skipped) {
			const task = state.tasks.find((candidate) => candidate.id === taskId)
			// Deleted, or moved by hand: either way the manager's write-off no longer applies.
			if (!task || task.stage !== stage) this.skipped.delete(taskId)
		}

		const waiting = this.waiting
		if (!waiting) return

		const task = state.tasks.find((candidate) => candidate.id === waiting.boardTaskId)
		if (!task) {
			this.waiting = undefined
			return
		}
		// Only a card that has left both the column it started in *and* the one the
		// action works in has finished. Treating the working column alone as the test
		// would read the moment before a started card has been moved into it as a
		// finished action, and pull the next card in on top of a live run.
		if (task.stage !== waiting.workingStage && task.stage !== waiting.fromStage) {
			this.waiting = undefined
			return
		}
		// Still in the working column. Only a run that has stopped working means the
		// action is over — a run parked on a question is still the user's to answer.
		// An action that produced no conversation at all never got going, and counts
		// as stalled rather than as something to wait on forever.
		if (waiting.historyTaskId && host.isConversationWorking(waiting.historyTaskId)) return

		host.log(
			`[BoardManager] ${formatBoardTaskNumber(task.number) ?? task.id.slice(0, 8)} did not leave ${task.stage}; setting it aside`,
		)
		this.waiting = undefined
		this.skipped.set(task.id, task.stage)
	}
}
