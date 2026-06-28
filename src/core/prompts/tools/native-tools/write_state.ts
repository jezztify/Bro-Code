import type OpenAI from "openai"

const WRITE_STATE_DESCRIPTION = `Write a durable state artifact under .brocode/state/<rootTaskId>/ keyed by name, without overwriting unrelated keys. Use this to hand off structured data (e.g. a plan, an API contract, findings) to a parent task or sibling subtask instead of relying solely on your final completion message.

The artifact is saved to disk as JSON or Markdown depending on 'format', is human-editable, and participates in checkpoints alongside code changes.

If this workflow declares a state schema (.brocode/state/<rootTaskId>/_schema.json), the key and format must match a declared entry.`

export default {
	type: "function",
	function: {
		name: "write_state",
		description: WRITE_STATE_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				key: {
					type: "string",
					description: "Artifact key to write (e.g. 'api-contract', 'plan', 'findings')",
				},
				content: {
					type: "string",
					description: "The artifact content. Must be valid JSON text when format is 'json'.",
				},
				format: {
					type: ["string", "null"],
					enum: ["json", "markdown", null],
					description: "Storage format for this artifact. Defaults to 'json'.",
				},
			},
			required: ["key", "content", "format"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
