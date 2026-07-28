import type { ClineMessage, KanbanBoard, KanbanItem, TodoItem } from "@roo-code/types"

import { readTaskMessages } from "../task-persistence/taskMessages"
import { getTodoListForTask } from "../tools/UpdateTodoListTool"
import { getLatestTodo } from "../../shared/todo"
import type { ClineProvider } from "./ClineProvider"

const RELATED_TASK_TITLE_MAX_LENGTH = 80

/**
 * Builds a read-model of the kanban board for a root task's plan (its todo list), enriched
 * with a summary of each linked subtask (relatedTaskId) pulled from task history.
 *
 * Reads the todo list from memory when the root task is the currently resident task, or from
 * disk (via its persisted ui messages) otherwise, since a task not on the active stack has no
 * in-memory Task instance to read from.
 */
export async function getKanbanBoardForRootTask(provider: ClineProvider, rootTaskId: string): Promise<KanbanBoard> {
	const currentTask = provider.getCurrentTask()

	let todos: TodoItem[]
	if (currentTask && currentTask.taskId === rootTaskId) {
		todos = getTodoListForTask(currentTask) ?? []
	} else {
		let messages: ClineMessage[]
		try {
			messages = await readTaskMessages({
				taskId: rootTaskId,
				globalStoragePath: provider.contextProxy.globalStorageUri.fsPath,
			})
		} catch {
			messages = []
		}
		todos = getLatestTodo(messages) ?? []
	}

	const items: KanbanItem[] = todos.map((todo) => {
		const item: KanbanItem = {
			id: todo.id,
			content: todo.content,
			status: todo.status,
			relatedTaskId: todo.relatedTaskId,
		}

		if (todo.relatedTaskId) {
			const relatedHistoryItem = provider.taskHistoryStore.get(todo.relatedTaskId)
			if (relatedHistoryItem) {
				item.relatedTask = {
					title:
						relatedHistoryItem.task.length > RELATED_TASK_TITLE_MAX_LENGTH
							? `${relatedHistoryItem.task.slice(0, RELATED_TASK_TITLE_MAX_LENGTH)}...`
							: relatedHistoryItem.task,
					status: relatedHistoryItem.status,
					totalCost: relatedHistoryItem.totalCost,
					ts: relatedHistoryItem.ts,
				}
			}
		}

		return item
	})

	const rootHistoryItem = provider.taskHistoryStore.get(rootTaskId)
	const rootTaskTitle = rootHistoryItem
		? rootHistoryItem.task.length > RELATED_TASK_TITLE_MAX_LENGTH
			? `${rootHistoryItem.task.slice(0, RELATED_TASK_TITLE_MAX_LENGTH)}...`
			: rootHistoryItem.task
		: undefined

	return { rootTaskId, rootTaskTitle, items }
}
