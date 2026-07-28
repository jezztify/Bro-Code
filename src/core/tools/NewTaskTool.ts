import * as vscode from "vscode"

import { TodoItem } from "@roo-code/types"

import { Task } from "../task/Task"
import { getModeBySlug } from "../../shared/modes"
import { formatResponse } from "../prompts/responses"
import { t } from "../../i18n"
import { parseMarkdownChecklist } from "./UpdateTodoListTool"
import { Package } from "../../shared/package"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

interface NewTaskParams {
	mode: string
	message: string
	todos?: string
	tier?: "trivial" | "standard" | "hard"
	todoId?: string
}

export class NewTaskTool extends BaseTool<"new_task"> {
	readonly name = "new_task" as const

	async execute(params: NewTaskParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { mode, message, todos, tier, todoId } = params
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			// Validate required parameters.
			if (!mode) {
				task.consecutiveMistakeCount++
				task.recordToolError("new_task")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("new_task", "mode"))
				return
			}

			if (!message) {
				task.consecutiveMistakeCount++
				task.recordToolError("new_task")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("new_task", "message"))
				return
			}

			// Get the VSCode setting for requiring todos.
			const provider = task.providerRef.deref()

			if (!provider) {
				pushToolResult(formatResponse.toolError("Provider reference lost"))
				return
			}

			const state = await provider.getState()

			// Use Package.name (dynamic at build time) as the VSCode configuration namespace.
			// Supports multiple extension variants (e.g., stable/nightly) without hardcoded strings.
			const requireTodos = vscode.workspace
				.getConfiguration(Package.name)
				.get<boolean>("newTaskRequireTodos", false)

			// Check if todos are required based on VSCode setting.
			// Note: `undefined` means not provided, empty string is valid.
			if (requireTodos && todos === undefined) {
				task.consecutiveMistakeCount++
				task.recordToolError("new_task")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("new_task", "todos"))
				return
			}

			// Parse todos if provided, otherwise use empty array
			let todoItems: TodoItem[] = []
			if (todos) {
				try {
					todoItems = parseMarkdownChecklist(todos)
				} catch (error) {
					task.consecutiveMistakeCount++
					task.recordToolError("new_task")
					task.didToolFailInCurrentTurn = true
					pushToolResult(formatResponse.toolError("Invalid todos format: must be a markdown checklist"))
					return
				}
			}

			// Validate todoId, if provided: it must reference an existing, pending item on
			// this task's own todo list. Delegating an already-in-progress/testing/completed
			// item, or an id that doesn't exist, would corrupt the kanban board's linkage.
			if (todoId !== undefined) {
				const referencedTodo = task.todoList?.find((t) => t.id === todoId)
				if (!referencedTodo || referencedTodo.status !== "pending") {
					task.consecutiveMistakeCount++
					task.recordToolError("new_task")
					task.didToolFailInCurrentTurn = true
					// handlePartial already rendered a "wants to create a new subtask" ask
					// bubble for this call while it was streaming in. We're rejecting before
					// ever reaching askApproval, so that ask would otherwise be left dangling
					// (never approved, never delegated) - but ChatRow's "View task" link for
					// every *later* new_task call in this same task counts position within
					// newTask ask messages and indexes into childIds by that position, on the
					// assumption every such ask resulted in exactly one child. A dangling ask
					// with no child breaks that assumption and makes every subsequent "View
					// task" link point at the wrong (an older) child. Discard it so the count
					// stays in sync.
					await discardDanglingNewTaskAsk(task).catch(() => {
						// Best-effort: worst case is the pre-existing "View task" position-drift
						// this was added to prevent, not a failure to report the actual error below.
					})
					pushToolResult(
						formatResponse.toolError(
							!referencedTodo
								? `Invalid todoId: no todo item with id "${todoId}" was found on the current todo list`
								: `Invalid todoId: todo item "${referencedTodo.content}" is not pending (status: ${referencedTodo.status})`,
						),
					)
					return
				}
			}

			task.consecutiveMistakeCount = 0

			// Un-escape one level of backslashes before '@' for hierarchical subtasks
			// Un-escape one level: \\@ -> \@ (removes one backslash for hierarchical subtasks)
			const unescapedMessage = message.replace(/\\\\@/g, "\\@")

			// Verify the mode exists
			const targetMode = getModeBySlug(mode, state?.customModes)

			if (!targetMode) {
				pushToolResult(formatResponse.toolError(`Invalid mode: ${mode}`))
				return
			}

			const toolMessage = JSON.stringify({
				tool: "newTask",
				mode: targetMode.name,
				content: message,
				todos: todoItems,
			})

			const didApprove = await askApproval("tool", toolMessage)

			if (!didApprove) {
				return
			}

			// Delegate parent and open child as sole active task
			const child = await (provider as any).delegateParentAndOpenChild({
				parentTaskId: task.taskId,
				message: unescapedMessage,
				initialTodos: todoItems,
				mode,
				tier,
				todoId,
			})

			// Reflect delegation in tool result (no pause/unpause, no wait)
			pushToolResult(`Delegated to child task ${child.taskId}`)
			return
		} catch (error) {
			await handleError("creating new task", error)
			return
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"new_task">): Promise<void> {
		const mode: string | undefined = block.params.mode
		const message: string | undefined = block.params.message
		const todos: string | undefined = block.params.todos

		const partialMessage = JSON.stringify({
			tool: "newTask",
			mode: mode ?? "",
			content: message ?? "",
			todos: todos,
		})

		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

/**
 * Remove a trailing "wants to create a new subtask" ask message that was rendered by
 * handlePartial while the tool call streamed in, when execute() is about to reject the call
 * before ever reaching askApproval. Left in place, that ask would count toward every later
 * new_task ask's position in ChatRow's newTask-index-into-childIds lookup without a
 * corresponding child ever having been created, permanently shifting every subsequent
 * "View task" link in this task onto the wrong (an earlier) child.
 */
async function discardDanglingNewTaskAsk(task: Task): Promise<void> {
	const messages = task.clineMessages
	if (!Array.isArray(messages) || messages.length === 0) {
		return
	}
	const last = messages.at(-1)

	if (last?.type !== "ask" || last.ask !== "tool") {
		return
	}

	try {
		const parsed = JSON.parse(last.text ?? "")
		if (parsed?.tool !== "newTask") {
			return
		}
	} catch {
		return
	}

	await task.overwriteClineMessages(messages.slice(0, -1))
}

export const newTaskTool = new NewTaskTool()
