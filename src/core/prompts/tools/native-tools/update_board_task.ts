import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "update_board_task",
		description:
			"Update a task card in the currently selected logical Tasks workspace. The user must approve this persistent board change.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				task_id: {
					type: "string",
					description: 'Number of the board task to update as shown on the card (e.g. "TASK-12"), or its ID.',
				},
				title: { type: ["string", "null"], description: "New title, or null to leave it unchanged." },
				description: {
					type: ["string", "null"],
					description: "New description, or null when not setting a description.",
				},
				stage: {
					type: ["string", "null"],
					enum: ["backlog", "scoped", "approved", "in_progress", "qa_validation", "done", null],
					description: "New board column, or null to leave it unchanged.",
				},
				clear_description: {
					type: "boolean",
					description: "Set true to clear the description. Must be false when setting or leaving the description.",
				},
			},
			required: ["task_id", "title", "description", "stage", "clear_description"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
