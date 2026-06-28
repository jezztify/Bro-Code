import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { writeArtifact, StateKeyError, StateSchemaError } from "../task-persistence/StateStore"

interface WriteStateParams {
	key: string
	content: string
	format?: "json" | "markdown"
}

export class WriteStateTool extends BaseTool<"write_state"> {
	readonly name = "write_state" as const

	async execute(params: WriteStateParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult, handleError, askApproval } = callbacks

		try {
			if (!params.key) {
				task.consecutiveMistakeCount++
				task.recordToolError("write_state")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("write_state", "key"))
				return
			}

			if (params.content === undefined) {
				task.consecutiveMistakeCount++
				task.recordToolError("write_state")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("write_state", "content"))
				return
			}

			const format = params.format ?? "json"

			const approvalMsg = JSON.stringify({ tool: "writeState", key: params.key, format })
			const didApprove = await askApproval("tool", approvalMsg)
			if (!didApprove) {
				pushToolResult("User declined to write state.")
				return
			}

			const rootTaskId = task.rootTaskId ?? task.taskId
			await writeArtifact(task.cwd, rootTaskId, params.key, params.content, format)

			task.consecutiveMistakeCount = 0
			pushToolResult(formatResponse.toolResult(`State artifact "${params.key}" written successfully.`))
		} catch (error) {
			if (error instanceof StateKeyError || error instanceof StateSchemaError) {
				task.recordToolError("write_state")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(error.message))
				return
			}
			await handleError("writing state", error as Error)
		}
	}
}

export const writeStateTool = new WriteStateTool()
