import type { BoardStage } from "@roo-code/types"

import { formatResponse } from "../prompts/responses"
import { Task } from "../task/Task"
import { BaseTool, type ToolCallbacks } from "./BaseTool"

interface UpdateBoardTaskParams {
	task_id: string
	title: string | null
	description: string | null
	stage: BoardStage | null
	clear_description: boolean
}

export class UpdateBoardTaskTool extends BaseTool<"update_board_task"> {
	readonly name = "update_board_task" as const

	async execute(params: UpdateBoardTaskParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		if (typeof params.task_id !== "string" || !params.task_id.trim()) {
			task.consecutiveMistakeCount++
			task.recordToolError(this.name)
			task.didToolFailInCurrentTurn = true
			pushToolResult(formatResponse.toolError("A board task ID is required."))
			return
		}
		const taskId = params.task_id.trim()
		if (params.description !== null && params.clear_description) {
			task.consecutiveMistakeCount++
			task.recordToolError(this.name)
			task.didToolFailInCurrentTurn = true
			pushToolResult(formatResponse.toolError("Set either a description or clear it, not both."))
			return
		}

		const update = {
			...(params.title !== null ? { title: params.title } : {}),
			...(params.description !== null ? { description: params.description } : {}),
			...(params.clear_description ? { description: null } : {}),
			...(params.stage !== null ? { stage: params.stage } : {}),
		}
		if (Object.keys(update).length === 0) {
			task.consecutiveMistakeCount++
			task.recordToolError(this.name)
			task.didToolFailInCurrentTurn = true
			pushToolResult(formatResponse.toolError("Provide at least one board task field to update."))
			return
		}

		try {
			const approved = await askApproval("tool", JSON.stringify({ tool: "updateBoardTask", taskId, update }))
			if (!approved) {
				pushToolResult("User declined to update the board task.")
				return
			}

			const provider = task.providerRef.deref()
			if (!provider) throw new Error("Provider reference lost while updating the board task")
			await provider.updateBoardTaskInSelectedWorkspace(taskId, update)
			pushToolResult(formatResponse.toolResult(`Updated board task: ${taskId}`))
		} catch (error) {
			await handleError("update board task", error instanceof Error ? error : new Error(String(error)))
		}
	}
}

export const updateBoardTaskTool = new UpdateBoardTaskTool()
