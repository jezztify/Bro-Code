import type OpenAI from "openai"

const UPDATE_TODO_LIST_DESCRIPTION = `Replace the entire TODO list with an updated checklist reflecting the current state. Always provide the full list; the system will overwrite the previous one. This tool is designed for step-by-step task tracking, allowing you to confirm completion of each step before updating, update multiple task statuses at once (e.g., mark one as completed and start the next), and dynamically add new todos discovered during long or complex tasks.

Checklist Format:
- Use a single-level markdown checklist (no nesting or subtasks)
- List todos in the intended execution order
- Status options: [ ] (pending), [-] (in progress), [t] (testing), [x] (completed)

Core Principles:
- Before updating, always confirm which todos have been completed
- You may update multiple statuses in a single update
- Add new actionable items as they're discovered
- Only mark a task as completed when fully accomplished
- Keep all unfinished tasks unless explicitly instructed to remove
- Most items are implemented directly by you, not delegated: for those, move an item straight from in progress ([-]) to completed ([x]) yourself once it's fully done, exactly as before.
- Only when you delegated an item to a subtask via new_task's todoId parameter does testing ([t]) happen automatically: once that subtask completes, its linked item moves from in-progress to testing on its own — you don't need to (and normally shouldn't) set it to testing yourself in that case. Once you've verified the delegated work, move it from testing to completed (or back to in progress, to send it back for rework).
- The tool result echoes each item's id in parentheses, e.g. "- [ ] (id: 3f2a9c1d) Implement auth middleware" — reference these ids as the todoId parameter of new_task when delegating that item to a subtask.
- If new_task rejects a todoId as "not pending" (already in progress), the item is already linked to a subtask - don't try to delegate it again. If that subtask stalled, failed, or was abandoned and the work needs to be redone, move the item back to pending ([ ]) yourself in your next update_todo_list call; this clears its old link so you can delegate it again (or do it yourself) as if it were new.

Example: Initial task list
{ "todos": "[x] Analyze requirements\\n[x] Design architecture\\n[-] Implement core logic\\n[ ] Write tests\\n[ ] Update documentation" }

Example: After completing implementation
{ "todos": "[x] Analyze requirements\\n[x] Design architecture\\n[x] Implement core logic\\n[-] Write tests\\n[ ] Update documentation\\n[ ] Add performance benchmarks" }

When to Use:
- Task involves multiple steps or requires ongoing tracking
- Need to update status of several todos at once
- New actionable items are discovered during execution
- Task is complex and benefits from stepwise progress tracking

When NOT to Use:
- Only a single, trivial task
- Task can be completed in one or two simple steps
- Request is purely conversational or informational`

const TODOS_PARAMETER_DESCRIPTION = `Full markdown checklist in execution order, using [ ] for pending, [-] for in progress, [t] for testing, and [x] for completed`

export default {
	type: "function",
	function: {
		name: "update_todo_list",
		description: UPDATE_TODO_LIST_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				todos: {
					type: "string",
					description: TODOS_PARAMETER_DESCRIPTION,
				},
			},
			required: ["todos"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
