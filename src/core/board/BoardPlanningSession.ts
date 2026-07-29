import type { ApiStream } from "../../api/transform/stream"
import {
	type BoardPlanningSessionState,
	type BoardStage,
	type BoardTask,
	type BoardWorkspace,
	boardStageSchema,
} from "@roo-code/types"
import { v7 as uuidv7 } from "uuid"

import { BoardStore } from "./BoardStore"
import { boardPlanningTools } from "./boardPlanningTools"

type PlanningToolName = "create_board_task" | "update_board_task"
type PlanningToolCall = { name: PlanningToolName; arguments: string }

export class BoardPlanningSession {
	readonly tools = boardPlanningTools
	readonly state: BoardPlanningSessionState
	private pendingCalls: PlanningToolCall[] = []

	constructor(
		private readonly store: BoardStore,
		workspace: BoardWorkspace,
		private readonly publish: (state: BoardPlanningSessionState) => Promise<void>,
	) {
		this.state = {
			id: uuidv7(),
			workspaceId: workspace.id,
			...(workspace.linkedWorkspacePath ? { linkedWorkspacePath: workspace.linkedWorkspacePath } : {}),
			approvalRequired: true,
			approved: false,
			assistantText: "",
			status: "planning",
		}
	}

	async start(stream: ApiStream): Promise<void> {
		const partialCalls = new Map<string, { name?: string; arguments: string }>()
		for await (const chunk of stream) {
			if (chunk.type === "text") this.state.assistantText += chunk.text
			if (chunk.type === "tool_call") this.queueToolCall(chunk.name, chunk.arguments)
			if (chunk.type === "tool_call_start") partialCalls.set(chunk.id, { name: chunk.name, arguments: "" })
			if (chunk.type === "tool_call_delta" && partialCalls.has(chunk.id))
				partialCalls.get(chunk.id)!.arguments += chunk.delta
			if (chunk.type === "tool_call_end") {
				const call = partialCalls.get(chunk.id)
				if (call?.name) this.queueToolCall(call.name, call.arguments)
			}
			if (chunk.type === "error") throw new Error(chunk.message)
		}
		this.state.status = "awaiting_approval"
		await this.publish(this.state)
	}

	async approve(): Promise<void> {
		if (this.state.status !== "awaiting_approval") throw new Error("Board plan is not ready for approval")
		this.state.approved = true
		this.state.status = "applying"
		await this.publish(this.state)
		for (const call of this.pendingCalls) await this.dispatch(call.name, JSON.parse(call.arguments))
		this.state.status = "complete"
		await this.publish(this.state)
	}

	async dispatch(name: PlanningToolName, args: unknown): Promise<BoardTask | undefined> {
		if (!this.state.approved) throw new Error("Board plan requires explicit user approval")
		if (name === "create_board_task") {
			const input = args as { title?: unknown; description?: unknown; stage?: unknown }
			if (
				typeof input.title !== "string" ||
				(input.description !== null && input.description !== undefined && typeof input.description !== "string")
			)
				throw new Error("Invalid create_board_task arguments")
			const stage = boardStageSchema.safeParse(input.stage)
			if (!stage.success) throw new Error("Invalid board stage")
			await this.store.createTask({
				workspaceId: this.state.workspaceId,
				title: input.title,
				...(typeof input.description === "string" ? { description: input.description } : {}),
				stage: stage.data,
			})
			return this.store.getSnapshot().tasks.at(-1)
		}

		const input = args as { taskId?: unknown; title?: unknown; description?: unknown; stage?: unknown }
		if (typeof input.taskId !== "string") throw new Error("Invalid update_board_task arguments")
		const task = this.store.getSnapshot().tasks.find((candidate) => candidate.id === input.taskId)
		if (!task || task.workspaceId !== this.state.workspaceId)
			throw new Error("Board task is not in this planning workspace")
		const update: { title?: string; description?: string; stage?: BoardStage } = {}
		if (typeof input.title === "string") update.title = input.title
		if (typeof input.description === "string") update.description = input.description
		if (input.stage !== null && input.stage !== undefined) {
			const stage = boardStageSchema.safeParse(input.stage)
			if (!stage.success) throw new Error("Invalid board stage")
			update.stage = stage.data
		}
		if (Object.keys(update).length === 0) throw new Error("update_board_task requires a change")
		await this.store.updateTask(task.id, update)
		return this.store.getSnapshot().tasks.find((candidate) => candidate.id === task.id)
	}

	private queueToolCall(name: string, args: string): void {
		if (name === "create_board_task" || name === "update_board_task")
			this.pendingCalls.push({ name, arguments: args })
	}
}
