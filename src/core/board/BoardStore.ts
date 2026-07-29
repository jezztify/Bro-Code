import * as fs from "fs/promises"
import * as path from "path"

import type { BoardStage, BoardState, BoardTask, BoardWorkspace, HistoryItem } from "@roo-code/types"
import { boardStateSchema } from "@roo-code/types"
import { v7 as uuidv7 } from "uuid"

import { GlobalFileNames } from "../../shared/globalFileNames"
import { safeWriteJson } from "../../utils/safeWriteJson"

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

	constructor(
		private readonly globalStoragePath: string,
		private readonly log: (message: string) => void = console.warn,
	) {
		this.initialized = new Promise((resolve) => {
			this.resolveInitialized = resolve
		})
	}

	async initialize(): Promise<void> {
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
			if (input.linkedWorkspacePath !== undefined) workspace.linkedWorkspacePath = input.linkedWorkspacePath || undefined
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
			if (input.stage !== undefined && input.stage !== task.stage) {
				task.stage = input.stage
				task.position = this.nextPosition(state, task.workspaceId, input.stage)
			}
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
			if (task.stage !== "in_progress") {
				task.stage = "in_progress"
				task.position = this.nextPosition(state, task.workspaceId, "in_progress")
			}
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
	 * Detach a cancelled execution run and return the card to the approved column so
	 * it can be started again. The cancelled conversation is left in task history.
	 */
	async unlinkExecutionTask(id: string): Promise<BoardState> {
		return this.mutate((state) => {
			const task = this.requireTask(state, id)
			task.linkedHistoryTaskId = undefined
			if (task.stage !== "approved") {
				task.stage = "approved"
				task.position = this.nextPosition(state, task.workspaceId, "approved")
			}
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
					task.stage = "scoped"
					task.position = this.nextPosition(state, task.workspaceId, "scoped")
					task.updatedAt = Date.now()
				}
			}
		})
	}

	async moveLinkedHistoryTaskToDone(historyTaskId: string): Promise<BoardState> {
		return this.mutate((state) => {
			for (const task of state.tasks) {
				if (task.linkedHistoryTaskId === historyTaskId && task.stage !== "done") {
					task.stage = "done"
					task.position = this.nextPosition(state, task.workspaceId, "done")
					task.updatedAt = Date.now()
				}
			}
		})
	}

	private async mutate(mutator: (state: BoardState) => void): Promise<BoardState> {
		const operation = this.writeLock.then(async () => {
			await this.initialized
			const next = structuredClone(this.state)
			mutator(next)
			const validated = boardStateSchema.parse(next)
			await safeWriteJson(this.getFilePath(), validated)
			this.state = validated
		})
		this.writeLock = operation.then(() => undefined, () => undefined)
		await operation
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

	private nextPosition(state: BoardState, workspaceId: string, stage: BoardStage): number {
		return state.tasks.filter((task) => task.workspaceId === workspaceId && task.stage === stage).reduce((max, task) => Math.max(max, task.position), -1) + 1
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
