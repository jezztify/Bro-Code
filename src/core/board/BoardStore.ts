import * as fs from "fs/promises"
import * as path from "path"

import type { BoardStage, BoardState, BoardTask, BoardWorkspace, HistoryItem } from "@roo-code/types"
import { BOARD_ACTIVITY_LIMIT, boardActivityOutcomeFor, boardStateSchema } from "@roo-code/types"
import { v7 as uuidv7 } from "uuid"

import { GlobalFileNames } from "../../shared/globalFileNames"
import { safeWriteJson } from "../../utils/safeWriteJson"

/** A card that has just changed column, reported to {@link BoardStore.setMoveNotifier}. */
export type BoardTaskMove = {
	/** The card as it stands after the move. */
	task: BoardTask
	from: BoardStage
	to: BoardStage
	/** Where this board's storage lives, so a notifier can reach the card's conversation. */
	globalStoragePath: string
}

/**
 * What the extension host was configured with when a move happened, stamped onto the
 * activity log. Resolved at move time rather than stored, because neither belongs to
 * the board: the mode comes from the card's column when it has one, and the API
 * configuration is whichever profile is selected. Both are optional — the mobile server
 * and tests drive the store with no host settings behind it.
 */
export type BoardActivityContext = {
	mode?: string
	apiConfigName?: string
}

const EMPTY_STATE: BoardState = {
	version: 1,
	workspaces: [],
	tasks: [],
	migrations: {},
}

export class BoardStore {
	private state: BoardState = structuredClone(EMPTY_STATE)
	private writeLock: Promise<void> = Promise.resolve()
	public readonly initialized: Promise<void>
	private resolveInitialized!: () => void
	private changeListeners = new Set<(state: BoardState) => void>()
	private initializeStarted = false
	/** Moves made by the mutation currently running, drained once it has been written. */
	private pendingMoves: Array<{ taskId: string; from: BoardStage; to: BoardStage }> = []

	/**
	 * What to do when a card changes column - writing a note into the card's
	 * conversation. Deliberately one notifier for the whole extension host rather than
	 * a per-instance listener like {@link onDidChange}: a change is broadcast to every
	 * window, but a move must be *reported* exactly once, or the same note would be
	 * appended to a conversation once per open window.
	 */
	private static moveNotifier: ((move: BoardTaskMove) => Promise<void>) | undefined

	/**
	 * Where the activity log gets the mode and API configuration a move happened under. Static
	 * for the same reason as {@link moveNotifier} — the answer is a property of the
	 * extension host, not of whichever window's store recorded the move. Synchronous
	 * because it is called from inside a mutation, which must not await mid-write.
	 */
	private static activityContext: (() => BoardActivityContext) | undefined

	/**
	 * One store per storage path, shared by every `ClineProvider` in the extension
	 * host. Each provider used to build its own store over the same `board.json`,
	 * and since a store reads that file exactly once (see `initialize`) and then
	 * writes its whole in-memory copy back on every mutation, a second provider -
	 * the popped-out board window is one - would serve stale cards and silently
	 * revert the other's edits the next time it saved anything.
	 *
	 * The constructor stays public for tests, which need genuinely independent
	 * instances to exercise reload-from-disk. Production code must use this.
	 */
	private static instances = new Map<string, BoardStore>()

	/**
	 * Drops every shared instance. Tests build many providers over the same mocked
	 * storage path, and without this each one would inherit the previous test's
	 * cards - which is the whole point of sharing in production. Called from a
	 * global `beforeEach` in `vitest.setup.ts`, not from production code.
	 */
	static resetInstancesForTests(): void {
		BoardStore.instances.clear()
		BoardStore.moveNotifier = undefined
		BoardStore.activityContext = undefined
	}

	/** See {@link BoardStore.moveNotifier}. `undefined` leaves moves unreported. */
	static setMoveNotifier(notifier: ((move: BoardTaskMove) => Promise<void>) | undefined): void {
		BoardStore.moveNotifier = notifier
	}

	/**
	 * See {@link BoardStore.activityContext}. `undefined` logs moves without a mode or
	 * API configuration rather than not logging them.
	 */
	static setActivityContext(resolve: (() => BoardActivityContext) | undefined): void {
		BoardStore.activityContext = resolve
	}

	static getInstance(globalStoragePath: string, log?: (message: string) => void): BoardStore {
		const existing = BoardStore.instances.get(globalStoragePath)

		if (existing) {
			return existing
		}

		const created = new BoardStore(globalStoragePath, log)
		BoardStore.instances.set(globalStoragePath, created)
		return created
	}

	constructor(
		private readonly globalStoragePath: string,
		private readonly log: (message: string) => void = console.warn,
	) {
		this.initialized = new Promise((resolve) => {
			this.resolveInitialized = resolve
		})
	}

	/**
	 * Notifies every subscriber whenever the board changes, so a mutation made in
	 * one window reaches the webviews of all the others (and the mobile server's
	 * postMessage listener). Returns an unsubscribe function - deliberately not a
	 * `vscode.Disposable`, to keep this module free of the `vscode` import.
	 */
	onDidChange(listener: (state: BoardState) => void | Promise<void>): () => void {
		this.changeListeners.add(listener)
		return () => this.changeListeners.delete(listener)
	}

	/**
	 * Awaited by `mutate`, so a mutation isn't considered finished until every
	 * subscriber has been told. Callers used to await the resulting webview post
	 * themselves (the old `ClineProvider.updateBoardState`); keeping that await
	 * here preserves their sequencing now that broadcasting moved into the store.
	 */
	private async emitChange(): Promise<void> {
		for (const listener of this.changeListeners) {
			try {
				await listener(this.getSnapshot())
			} catch (error) {
				this.log(`[BoardStore] change listener threw: ${String(error)}`)
			}
		}
	}

	/**
	 * Reports finished moves. A notifier that throws must not fail the mutation that
	 * moved the card: the card has already moved, and a note that could not be written
	 * is worth a log, not a rolled-back board.
	 */
	private async emitMoves(moves: BoardTaskMove[]): Promise<void> {
		const notifier = BoardStore.moveNotifier
		if (!notifier) return
		for (const move of moves) {
			try {
				await notifier(move)
			} catch (error) {
				this.log(`[BoardStore] move notifier threw: ${String(error)}`)
			}
		}
	}

	async initialize(): Promise<void> {
		// Every provider sharing this store calls initialize(); only the first may
		// run, or a later one would reset `state` to whatever is on disk and drop
		// mutations made in between.
		if (this.initializeStarted) {
			return this.initialized
		}

		this.initializeStarted = true

		try {
			const filePath = this.getFilePath()
			const raw = await fs.readFile(filePath, "utf8")
			const parsed = boardStateSchema.safeParse(JSON.parse(raw))
			if (!parsed.success) {
				this.log("[BoardStore] Invalid board snapshot; starting with an empty board")
				this.state = structuredClone(EMPTY_STATE)
			} else {
				this.state = parsed.data
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				this.log(`[BoardStore] Unable to read board snapshot; starting empty: ${String(error)}`)
			}
			this.state = structuredClone(EMPTY_STATE)
		} finally {
			this.resolveInitialized()
		}
		await this.backfillTaskNumbers()
	}

	/**
	 * Give cards saved before numbering existed a `TASK#`, oldest first, so the
	 * numbers a user already sees on a reopened board match the order the cards were
	 * created in. A no-op once every card has one.
	 */
	private async backfillTaskNumbers(): Promise<void> {
		if (this.state.tasks.every((task) => task.number !== undefined)) {
			return
		}
		try {
			await this.mutate((state) => {
				for (const task of [...state.tasks].sort((a, b) => a.createdAt - b.createdAt)) {
					task.number ??= this.takeTaskNumber(state)
				}
			})
		} catch (error) {
			this.log(`[BoardStore] Unable to assign task numbers: ${String(error)}`)
		}
	}

	getSnapshot(): BoardState {
		return structuredClone(this.state)
	}

	async importHistoryOnce(history: HistoryItem[]): Promise<BoardState> {
		return this.mutate((state) => {
			if (state.migrations.historyImport === 1) {
				return
			}
			state.migrations.historyImport = 1
			const topLevel = history.filter((item) => !item.parentTaskId)
			if (topLevel.length === 0) {
				return
			}
			const now = Date.now()
			const workspace: BoardWorkspace = {
				id: uuidv7(),
				name: "Imported tasks",
				createdAt: now,
				updatedAt: now,
			}
			state.workspaces.push(workspace)
			for (const item of topLevel) {
				state.tasks.push({
					id: uuidv7(),
					workspaceId: workspace.id,
					title: item.task,
					description: undefined,
					number: this.takeTaskNumber(state),
					stage: item.status === "completed" ? "done" : "backlog",
					position: this.nextPosition(state, workspace.id, item.status === "completed" ? "done" : "backlog"),
					createdAt: item.ts || now,
					updatedAt: now,
					linkedHistoryTaskId: item.id,
				})
			}
			state.selectedWorkspaceId ??= workspace.id
		})
	}

	async createWorkspace(name: string, linkedWorkspacePath?: string): Promise<BoardState> {
		return this.mutate((state) => {
			const now = Date.now()
			const workspace: BoardWorkspace = {
				id: uuidv7(),
				name: name.trim(),
				createdAt: now,
				updatedAt: now,
				...(linkedWorkspacePath ? { linkedWorkspacePath } : {}),
			}
			state.workspaces.push(workspace)
			state.selectedWorkspaceId = workspace.id
		})
	}

	async updateWorkspace(id: string, input: { name?: string; linkedWorkspacePath?: string }): Promise<BoardState> {
		return this.mutate((state) => {
			const workspace = this.requireWorkspace(state, id)
			if (input.name !== undefined) workspace.name = input.name.trim()
			if (input.linkedWorkspacePath !== undefined)
				workspace.linkedWorkspacePath = input.linkedWorkspacePath || undefined
			workspace.updatedAt = Date.now()
		})
	}

	/**
	 * Set the mode every card in a column is run in. `null` clears it, returning the
	 * column to whichever mode is selected when a card starts.
	 */
	async setColumnMode(workspaceId: string, stage: BoardStage, mode: string | null): Promise<BoardState> {
		return this.mutate((state) => {
			const workspace = this.requireWorkspace(state, workspaceId)
			const columnModes = { ...workspace.columnModes }
			if (mode) columnModes[stage] = mode
			else delete columnModes[stage]
			workspace.columnModes = Object.keys(columnModes).length > 0 ? columnModes : undefined
			workspace.updatedAt = Date.now()
		})
	}

	async deleteWorkspace(id: string): Promise<BoardState> {
		return this.mutate((state) => {
			this.requireWorkspace(state, id)
			state.workspaces = state.workspaces.filter((workspace) => workspace.id !== id)
			state.tasks = state.tasks.filter((task) => task.workspaceId !== id)
			// The log is read per workspace, so entries for a deleted one are unreachable.
			state.activity = state.activity?.filter((entry) => entry.workspaceId !== id)
			if (state.selectedWorkspaceId === id) state.selectedWorkspaceId = state.workspaces[0]?.id
		})
	}

	async selectWorkspace(id: string): Promise<BoardState> {
		return this.mutate((state) => {
			this.requireWorkspace(state, id)
			state.selectedWorkspaceId = id
		})
	}

	async createTask(input: {
		workspaceId: string
		title?: string
		description?: string
		stage?: BoardStage
	}): Promise<BoardState> {
		return this.mutate((state) => {
			this.requireWorkspace(state, input.workspaceId)
			const now = Date.now()
			const stage = input.stage ?? "backlog"
			state.tasks.push({
				id: uuidv7(),
				workspaceId: input.workspaceId,
				title: input.title ?? "",
				description: input.description,
				number: this.takeTaskNumber(state),
				stage,
				position: this.nextPosition(state, input.workspaceId, stage),
				createdAt: now,
				updatedAt: now,
			})
		})
	}

	async updateTask(
		id: string,
		input: Partial<Pick<BoardTask, "title" | "stage" | "position">> & {
			description?: string | null
		},
	): Promise<BoardState> {
		return this.mutate((state) => {
			const task = this.requireTask(state, id)
			if (input.title !== undefined) task.title = input.title
			if (input.description !== undefined) task.description = input.description || undefined
			if (input.stage !== undefined) this.moveToStage(state, task, input.stage)
			if (input.position !== undefined) task.position = input.position
			task.updatedAt = Date.now()
		})
	}

	async deleteTask(id: string): Promise<BoardState> {
		return this.mutate((state) => {
			this.requireTask(state, id)
			state.tasks = state.tasks.filter((task) => task.id !== id)
		})
	}

	async linkTaskToHistory(id: string, historyTaskId: string): Promise<BoardState> {
		return this.mutate((state) => {
			const task = this.requireTask(state, id)
			if (task.linkedHistoryTaskId) throw new Error("Board task is already linked to an execution task")
			task.linkedHistoryTaskId = historyTaskId
			this.moveToStage(state, task, "in_progress")
			task.updatedAt = Date.now()
		})
	}

	async linkRefinementTask(id: string, historyTaskId: string): Promise<BoardState> {
		return this.mutate((state) => {
			const task = this.requireTask(state, id)
			if (task.linkedRefinementTaskId) throw new Error("Board task is already linked to a refinement chat")
			task.linkedRefinementTaskId = historyTaskId
			task.updatedAt = Date.now()
		})
	}

	/**
	 * Attach the run that checks a finished implementation against the card's
	 * acceptance criteria. Validation is what the QA validation column is for, so a
	 * card being validated is held there for as long as the check runs.
	 */
	async linkValidationTask(id: string, historyTaskId: string): Promise<BoardState> {
		return this.mutate((state) => {
			const task = this.requireTask(state, id)
			if (task.linkedValidationTaskId) throw new Error("Board task is already linked to a validation chat")
			task.linkedValidationTaskId = historyTaskId
			this.moveToStage(state, task, "qa_validation")
			task.updatedAt = Date.now()
		})
	}

	/**
	 * Forget a card's validation chat so it can be validated again. Used when the
	 * conversation is gone from history: without this the card keeps a Validate button
	 * that can only ever fail to reveal a conversation that no longer exists.
	 */
	async unlinkValidationTask(id: string): Promise<BoardState> {
		return this.mutate((state) => {
			const task = this.requireTask(state, id)
			task.linkedValidationTaskId = undefined
			task.updatedAt = Date.now()
		})
	}

	/**
	 * Detach a cancelled execution run and return the card to the approved column so
	 * it can be started again. The cancelled conversation is left in task history.
	 * Any validation of the abandoned implementation goes with it, so the card that
	 * gets started again is validated afresh.
	 */
	async unlinkExecutionTask(id: string): Promise<BoardState> {
		return this.mutate((state) => {
			const task = this.requireTask(state, id)
			task.linkedHistoryTaskId = undefined
			task.linkedValidationTaskId = undefined
			this.moveToStage(state, task, "approved")
			task.updatedAt = Date.now()
		})
	}

	/**
	 * Promote a card whose refinement chat has finished. Only backlog cards move:
	 * if the refiner already scoped the card itself, or the user has since pushed it
	 * further along, its stage is left alone.
	 */
	async moveLinkedRefinementTaskToScoped(historyTaskId: string): Promise<BoardState> {
		return this.mutate((state) => {
			for (const task of state.tasks) {
				if (task.linkedRefinementTaskId === historyTaskId && task.stage === "backlog") {
					this.moveToStage(state, task, "scoped")
					task.updatedAt = Date.now()
				}
			}
		})
	}

	/**
	 * Hand a finished implementation over to validation rather than straight to done:
	 * a card is only retired once its acceptance criteria have been checked. A card the
	 * validator sent back for more work returns here when the execution run reports
	 * finishing again, so fixes get re-validated. Cards already in validation or
	 * retired to done are left where they are.
	 */
	async moveLinkedHistoryTaskToQaValidation(historyTaskId: string): Promise<BoardState> {
		return this.mutate((state) => {
			for (const task of state.tasks) {
				if (
					task.linkedHistoryTaskId === historyTaskId &&
					task.stage !== "qa_validation" &&
					task.stage !== "done"
				) {
					this.moveToStage(state, task, "qa_validation")
					// The implementation has changed since the last check, so its verdict no
					// longer applies: the card needs a fresh validation run, not the old chat.
					task.linkedValidationTaskId = undefined
					task.updatedAt = Date.now()
				}
			}
		})
	}

	/**
	 * Retire a card whose validation run has finished. Only cards still in validation
	 * move: a validator that found unmet criteria sends its card back itself, and
	 * that decision outranks the completion that follows it.
	 */
	async moveLinkedValidationTaskToDone(historyTaskId: string): Promise<BoardState> {
		return this.mutate((state) => {
			for (const task of state.tasks) {
				if (task.linkedValidationTaskId === historyTaskId && task.stage === "qa_validation") {
					this.moveToStage(state, task, "done")
					task.updatedAt = Date.now()
				}
			}
		})
	}

	private async mutate(mutator: (state: BoardState) => void): Promise<BoardState> {
		// Held locally rather than read back off the instance after the lock is released,
		// so a mutation queued behind this one cannot drain the moves this one made.
		let moves: BoardTaskMove[] = []
		const operation = this.writeLock.then(async () => {
			await this.initialized
			this.pendingMoves = []
			const next = structuredClone(this.state)
			mutator(next)
			const validated = boardStateSchema.parse(next)
			await safeWriteJson(this.getFilePath(), validated)
			this.state = validated
			moves = this.pendingMoves.flatMap(({ taskId, from, to }) => {
				// A card the same mutation went on to delete has no move worth reporting.
				const task = validated.tasks.find((candidate) => candidate.id === taskId)
				return task ? [{ task, from, to, globalStoragePath: this.globalStoragePath }] : []
			})
			this.pendingMoves = []
		})
		this.writeLock = operation.then(
			() => undefined,
			() => undefined,
		)
		await operation
		// Single choke point for every write, so every board change - whichever
		// window or the phone triggered it - fans out from here.
		await this.emitChange()
		await this.emitMoves(moves)
		return this.getSnapshot()
	}

	/**
	 * Claim the next `TASK#`. Read from a stored counter rather than from the highest
	 * number in use, so deleting the newest card does not hand its number to the next
	 * one and leave two conversations referring to the same `TASK#`.
	 */
	private takeTaskNumber(state: BoardState): number {
		const number = state.nextTaskNumber ?? 1
		state.nextTaskNumber = number + 1
		return number
	}

	/**
	 * Move a card into another column, remembering where it came from so the card can
	 * tell the user what happened to it. Every stage change goes through here - a drag,
	 * an edit, or the pipeline promoting a card on its own - so a move made while
	 * nobody was watching the board is never silent. A card told to stay where it is
	 * has not moved, and keeps whatever move it was already showing.
	 */
	private moveToStage(state: BoardState, task: BoardTask, stage: BoardStage): void {
		if (task.stage === stage) return
		this.pendingMoves.push({ taskId: task.id, from: task.stage, to: stage })
		this.recordActivity(state, task, stage)
		task.stage = stage
		task.position = this.nextPosition(state, task.workspaceId, stage)
	}

	/**
	 * Write the move into the activity log. Called before the card is moved, so the
	 * card's current stage is still the column it is leaving.
	 *
	 * The mode recorded is the one the column the card is *leaving* runs in: that is
	 * the column whose work produced this move — refinement runs from backlog, execution
	 * from approved, validation from QA validation.
	 */
	private recordActivity(state: BoardState, task: BoardTask, stage: BoardStage): void {
		const context = BoardStore.activityContext?.() ?? {}
		const columnMode = state.workspaces.find((workspace) => workspace.id === task.workspaceId)?.columnModes?.[
			task.stage
		]
		const activity = state.activity ?? []
		activity.push({
			id: uuidv7(),
			workspaceId: task.workspaceId,
			taskId: task.id,
			taskNumber: task.number,
			taskTitle: task.title,
			from: task.stage,
			to: stage,
			outcome: boardActivityOutcomeFor(task.stage, stage),
			mode: columnMode ?? context.mode,
			apiConfigName: context.apiConfigName,
			at: Date.now(),
		})
		// Oldest first, so trimming from the front keeps the most recent window.
		state.activity = activity.slice(-BOARD_ACTIVITY_LIMIT)
	}

	private nextPosition(state: BoardState, workspaceId: string, stage: BoardStage): number {
		return (
			state.tasks
				.filter((task) => task.workspaceId === workspaceId && task.stage === stage)
				.reduce((max, task) => Math.max(max, task.position), -1) + 1
		)
	}

	private requireWorkspace(state: BoardState, id: string): BoardWorkspace {
		const workspace = state.workspaces.find((candidate) => candidate.id === id)
		if (!workspace) throw new Error(`Board workspace ${id} does not exist`)
		return workspace
	}

	private requireTask(state: BoardState, id: string): BoardTask {
		const task = state.tasks.find((candidate) => candidate.id === id)
		if (!task) throw new Error(`Board task ${id} does not exist`)
		return task
	}

	private getFilePath(): string {
		return path.join(this.globalStoragePath, GlobalFileNames.board)
	}
}
