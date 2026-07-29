import { formatBoardTaskNumber, type BoardStage } from "@roo-code/types"

import { formatResponse } from "../prompts/responses"
import { Task } from "../task/Task"
import type { ToolUse } from "../../shared/tools"
import { BaseTool, type ToolCallbacks } from "./BaseTool"

interface CreateBoardTaskParams {
	title: string
	description: string | null
	stage: BoardStage
}

export class CreateBoardTaskTool extends BaseTool<"create_board_task"> {
	readonly name = "create_board_task" as const

	async execute(params: CreateBoardTaskParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const title = params.title.trim()

		if (!title) {
			task.consecutiveMistakeCount++
			task.recordToolError(this.name)
			task.didToolFailInCurrentTurn = true
			pushToolResult(formatResponse.toolError("A board task title cannot be empty."))
			return
		}

		try {
			const approved = await askApproval(
				"tool",
				JSON.stringify({ tool: "createBoardTask", title, description: params.description, stage: params.stage }),
			)
			if (!approved) {
				pushToolResult("User declined to create the board task.")
				return
			}

			const provider = task.providerRef.deref()
			if (!provider) throw new Error("Provider reference lost while creating the board task")

			const created = await provider.createBoardTaskInSelectedWorkspace({
				title,
				...(params.description ? { description: params.description } : {}),
				stage: params.stage,
			})
			const number = formatBoardTaskNumber(created?.number)
			pushToolResult(formatResponse.toolResult(`Created board task${number ? ` ${number}` : ""}: ${title}`))
		} catch (error) {
			await handleError("create board task", error instanceof Error ? error : new Error(String(error)))
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"create_board_task">): Promise<void> {
		if (block.nativeArgs?.title) {
			await task
				.ask(
					"tool",
					JSON.stringify({ tool: "createBoardTask", title: block.nativeArgs.title, stage: block.nativeArgs.stage }),
					block.partial,
				)
				.catch(() => {})
		}
	}
}

export const createBoardTaskTool = new CreateBoardTaskTool()