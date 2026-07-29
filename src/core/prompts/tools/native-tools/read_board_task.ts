import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "read_board_task",
		description:
			"Read task cards in the currently selected logical Tasks workspace. Provide a task ID to read one card, or null to list all cards in the selected workspace.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				task_id: {
					type: ["string", "null"],
					description:
						'Board task number as shown on the card (e.g. "TASK-12") or its ID, or null to list the selected workspace\'s cards.',
				},
			},
			required: ["task_id"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
