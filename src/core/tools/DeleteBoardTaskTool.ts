import { formatResponse } from "../prompts/responses"
import { Task } from "../task/Task"
import { BaseTool, type ToolCallbacks } from "./BaseTool"

interface DeleteBoardTaskParams {
	task_id: string
}

export class DeleteBoardTaskTool extends BaseTool<"delete_board_task"> {
	readonly name = "delete_board_task" as const

	async execute(params: DeleteBoardTaskParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		if (typeof params.task_id !== "string" || !params.task_id.trim()) {
			task.consecutiveMistakeCount++
			task.recordToolError(this.name)
			task.didToolFailInCurrentTurn = true
			pushToolResult(formatResponse.toolError("A board task ID is required."))
			return
		}
		const taskId = params.task_id.trim()

		try {
			const approved = await askApproval("tool", JSON.stringify({ tool: "deleteBoardTask", taskId }))
			if (!approved) {
				pushToolResult("User declined to delete the board task.")
				return
			}

			const provider = task.providerRef.deref()
			if (!provider) throw new Error("Provider reference lost while deleting the board task")
			await provider.deleteBoardTaskInSelectedWorkspace(taskId)
			pushToolResult(formatResponse.toolResult(`Deleted board task: ${taskId}`))
		} catch (error) {
			await handleError("delete board task", error instanceof Error ? error : new Error(String(error)))
		}
	}
}

export const deleteBoardTaskTool = new DeleteBoardTaskTool()
