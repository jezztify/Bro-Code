import type OpenAI from "openai"

const READ_STATE_DESCRIPTION = `Read a durable state artifact written by this task or one of its subtasks. State artifacts live under .brocode/state/<rootTaskId>/ on disk and are read fresh on every call (if a human edited the file, you'll see the edit). Use this to pick up structured hand-off (e.g. a plan, an API contract, findings) written by a parent or sibling subtask instead of relying solely on the conversation history.

Returns null content if the key has never been written.`

export default {
	type: "function",
	function: {
		name: "read_state",
		description: READ_STATE_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				key: {
					type: "string",
					description: "Artifact key to read (e.g. 'api-contract', 'plan', 'findings')",
				},
			},
			required: ["key"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
