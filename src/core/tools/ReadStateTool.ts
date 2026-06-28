import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { readArtifact, StateKeyError } from "../task-persistence/StateStore"

interface ReadStateParams {
	key: string
}

export class ReadStateTool extends BaseTool<"read_state"> {
	readonly name = "read_state" as const

	async execute(params: ReadStateParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult, handleError } = callbacks

		try {
			if (!params.key) {
				task.consecutiveMistakeCount++
				task.recordToolError("read_state")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("read_state", "key"))
				return
			}

			const rootTaskId = task.rootTaskId ?? task.taskId
			const artifact = await readArtifact(task.cwd, rootTaskId, params.key)

			task.consecutiveMistakeCount = 0

			if (!artifact) {
				pushToolResult(formatResponse.toolResult(`No state artifact found for key "${params.key}".`))
				return
			}

			pushToolResult(
				formatResponse.toolResult(
					`State artifact "${artifact.key}" (format: ${artifact.format}):\n\n${artifact.content}`,
				),
			)
		} catch (error) {
			if (error instanceof StateKeyError) {
				task.recordToolError("read_state")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(error.message))
				return
			}
			await handleError("reading state", error as Error)
		}
	}
}

export const readStateTool = new ReadStateTool()
