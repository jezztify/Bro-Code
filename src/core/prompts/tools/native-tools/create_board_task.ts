import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "create_board_task",
		description:
			"Create a titled task card in the currently selected logical Tasks workspace. The user must approve this persistent board change.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				title: { type: "string", description: "Concise task title." },
				description: { type: ["string", "null"], description: "Optional task description." },
				stage: {
					type: "string",
					enum: ["backlog", "scoped", "approved", "in_progress", "qa_validation", "done"],
					description: "Initial board column.",
				},
			},
			required: ["title", "description", "stage"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool