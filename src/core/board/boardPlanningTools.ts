import type OpenAI from "openai"

const stage = {
	type: "string",
	enum: ["backlog", "scoped", "approved", "in_progress", "done"],
} as const

export const createBoardTaskTool = {
	type: "function",
	function: {
		name: "create_board_task",
		description: "Add a proposed card to the active board workspace after the user approves this planning session.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				title: { type: "string" },
				description: { type: ["string", "null"] },
				stage,
			},
			required: ["title", "description", "stage"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

export const updateBoardTaskTool = {
	type: "function",
	function: {
		name: "update_board_task",
		description: "Update a card in the active board workspace after the user approves this planning session.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				taskId: { type: "string" },
				title: { type: ["string", "null"] },
				description: { type: ["string", "null"] },
				stage: { ...stage, type: ["string", "null"] },
			},
			required: ["taskId", "title", "description", "stage"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

export const boardPlanningTools = [createBoardTaskTool, updateBoardTaskTool] as OpenAI.Chat.ChatCompletionTool[]
