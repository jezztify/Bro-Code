import { z } from "zod"

import type { HistoryItem } from "./history.js"

/**
 * TodoStatus
 */
export const todoStatusSchema = z.enum(["pending", "in_progress", "testing", "completed"] as const)

export type TodoStatus = z.infer<typeof todoStatusSchema>

/**
 * TodoItem
 */
export const todoItemSchema = z.object({
	id: z.string(),
	content: z.string(),
	status: todoStatusSchema,
	relatedTaskId: z.string().optional(),
})

export type TodoItem = z.infer<typeof todoItemSchema>

/**
 * KanbanItem / KanbanBoard
 *
 * Read-model of a root task's plan (its todo list) for the kanban board view, enriched with a
 * summary of each item's linked subtask (if any) pulled from task history.
 */
export interface KanbanItem {
	id: string
	content: string
	status: TodoStatus
	relatedTaskId?: string
	relatedTask?: {
		title: string
		status: HistoryItem["status"]
		totalCost: number
		ts: number
	}
}

export interface KanbanBoard {
	rootTaskId: string
	/** The root task's own title, so a board opened in its own editor tab still shows whose plan it is. */
	rootTaskTitle?: string
	items: KanbanItem[]
}
