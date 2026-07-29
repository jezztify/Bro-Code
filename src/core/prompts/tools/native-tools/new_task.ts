import type OpenAI from "openai"

/**
 * Options for customizing the new_task tool definition.
 */
export interface NewTaskToolOptions {
	/** Whether the workspace mandates an initial todo list (`newTaskRequireTodos`, default: false) */
	requireTodos?: boolean
}

// The schema is `strict`, which means every property has to be listed in `required` even when it
// is optional - optionality is expressed as a `null` type instead. Models read that `required`
// array literally, so each optional parameter has to say, in its own description, that null is a
// normal answer. Without that, models invent a precondition ("new_task needs a todoId or todos")
// and go do busywork - building a todo list they were never asked for - just to satisfy it.
const NULLABLE_HINT = `Pass null if it does not apply - null is expected here and needs no justification.`

const NEW_TASK_DESCRIPTION = (requireTodos: boolean) =>
	`Create a new task instance in the chosen mode using your provided message.

Only mode and message carry information you must supply. ${
		requireTodos ? "todos is also mandatory in this workspace. " : ""
	}Every other parameter is optional and takes null; passing null is not a failure to satisfy the tool, and nothing has to be prepared in order to fill them in.

CRITICAL: This tool MUST be called alone. Do NOT call this tool alongside other tools in the same message turn. If you need to gather information before delegating, use other tools in a separate turn first, then call new_task by itself in the next turn.`

const MODE_PARAMETER_DESCRIPTION = `Slug of the mode to begin the new task in (e.g., code, debug, architect)`

const MESSAGE_PARAMETER_DESCRIPTION = `Initial user instructions or context for the new task`

const TODOS_PARAMETER_DESCRIPTION = (requireTodos: boolean) =>
	requireTodos
		? `Initial todo list for the new task, written as a markdown checklist. This workspace requires it, so it may not be null.`
		: `Initial todo list for the new task, written as a markdown checklist - useful when you have already broken the work down and want to hand that breakdown over. ${NULLABLE_HINT} Do not draw up a todo list merely to have something to put here; the new task can plan its own work.`

const TIER_PARAMETER_DESCRIPTION = `Difficulty tier for this step ("trivial" | "standard" | "hard"), used to route the subtask to a provider profile configured for that tier (Settings -> Providers). If the tier has no mapped profile, the target mode's own configured profile is used, falling back to the global default. ${NULLABLE_HINT}`

const TODO_ID_PARAMETER_DESCRIPTION = `Id of an item on the todo list you are already tracking (ids are echoed in your most recent update_todo_list result) that this subtask accomplishes. When provided, that item moves to in-progress and is linked to this subtask, so its status tracks the subtask's progress. ${NULLABLE_HINT} It only applies when you are delegating an item you are already tracking - never create a todo list just to obtain an id for this parameter.`

/**
 * Build the new_task tool definition.
 *
 * @param options - Configuration options for the tool
 * @returns The new_task tool definition
 */
export function createNewTaskTool({ requireTodos = false }: NewTaskToolOptions = {}) {
	return {
		type: "function",
		function: {
			name: "new_task",
			description: NEW_TASK_DESCRIPTION(requireTodos),
			strict: true,
			parameters: {
				type: "object",
				properties: {
					mode: {
						type: "string",
						description: MODE_PARAMETER_DESCRIPTION,
					},
					message: {
						type: "string",
						description: MESSAGE_PARAMETER_DESCRIPTION,
					},
					todos: {
						type: requireTodos ? "string" : ["string", "null"],
						description: TODOS_PARAMETER_DESCRIPTION(requireTodos),
					},
					tier: {
						type: ["string", "null"],
						enum: ["trivial", "standard", "hard", null],
						description: TIER_PARAMETER_DESCRIPTION,
					},
					todoId: {
						type: ["string", "null"],
						description: TODO_ID_PARAMETER_DESCRIPTION,
					},
				},
				required: ["mode", "message", "todos", "tier", "todoId"],
				additionalProperties: false,
			},
		},
	} satisfies OpenAI.Chat.ChatCompletionTool
}

export default createNewTaskTool()
