import { formatResponse } from "../prompts/responses"
import { Task } from "../task/Task"
import { BaseTool, type ToolCallbacks } from "./BaseTool"

interface ReadBoardTaskParams {
	task_id: string | null
}

export class ReadBoardTaskTool extends BaseTool<"read_board_task"> {
	readonly name = "read_board_task" as const

	async execute(params: ReadBoardTaskParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		if (params.task_id !== null && (typeof params.task_id !== "string" || !params.task_id.trim())) {
			task.consecutiveMistakeCount++
			task.recordToolError(this.name)
			task.didToolFailInCurrentTurn = true
			pushToolResult(formatResponse.toolError("A board task ID must be a non-empty string or null."))
			return
		}

		try {
			const taskId = params.task_id?.trim() || undefined
			const approved = await askApproval("tool", JSON.stringify({ tool: "readBoardTask", taskId }))
			if (!approved) {
				pushToolResult("User declined to read the board tasks.")
				return
			}

			const provider = task.providerRef.deref()
			if (!provider) throw new Error("Provider reference lost while reading board tasks")

			const boardTasks = await provider.readBoardTasksInSelectedWorkspace(taskId)
			pushToolResult(formatResponse.toolResult(JSON.stringify(boardTasks)))
		} catch (error) {
			await handleError("read board task", error instanceof Error ? error : new Error(String(error)))
		}
	}
}

export const readBoardTaskTool = new ReadBoardTaskTool()
