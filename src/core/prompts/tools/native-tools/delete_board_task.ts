import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "delete_board_task",
		description:
			"Delete a task card from the currently selected logical Tasks workspace. The user must approve this permanent board change.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				task_id: {
					type: "string",
					description: 'Number of the board task to delete as shown on the card (e.g. "TASK-12"), or its ID.',
				},
			},
			required: ["task_id"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
