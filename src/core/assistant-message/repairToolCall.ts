import type { ApiHandlerCreateMessageMetadata } from "../../api"
import type { ApiStream } from "../../api/transform/stream"
import type { ToolName } from "@bro-code/types"

import type { Task } from "../task/Task"
import type { ClineProvider } from "../webview/ClineProvider"
import type { ToolParamName, ToolUse } from "../../shared/tools"
import { getNativeTools } from "../prompts/tools/native-tools"
import { NativeToolCallParser } from "./NativeToolCallParser"

interface RepairToolCallParams {
	toolName: ToolName
	toolCallId: string
	rawParams: Partial<Record<ToolParamName, string>>
	errorMessage: string
	state: Awaited<ReturnType<ClineProvider["getState"]>> | undefined
}

interface DrainedToolCall {
	id: string
	name: string
	arguments: string
}

/**
 * Drains a single forced tool call out of a stream. Only handles the two raw chunk
 * shapes providers actually emit for tool calls ("tool_call" for complete calls,
 * "tool_call_partial" for streamed ones) — the derived "tool_call_start"/"delta"/"end"
 * triple is produced by NativeToolCallParser's own state machine, never by providers
 * directly, so it's irrelevant here.
 */
async function drainSingleToolCall(stream: ApiStream): Promise<DrainedToolCall | null> {
	let id: string | undefined
	let name: string | undefined
	let argsBuf = ""

	for await (const chunk of stream) {
		if (chunk.type === "tool_call") {
			return { id: chunk.id, name: chunk.name, arguments: chunk.arguments }
		}
		if (chunk.type === "tool_call_partial") {
			id ??= chunk.id
			name ??= chunk.name
			if (chunk.arguments) {
				argsBuf += chunk.arguments
			}
		}
		if (chunk.type === "error") {
			return null
		}
	}

	return id && name ? { id, name, arguments: argsBuf } : null
}

/**
 * Hands a single malformed tool call off to a separate, user-configured helper LLM for
 * repair. The helper only ever sees the tool's schema, the exact malformed call, and the
 * exact error — never the surrounding conversation — and is forced (via tool_choice) to
 * respond with a valid call for that same tool, so the provider's own schema validation
 * guarantees a well-formed result.
 *
 * Returns `undefined` (never throws) whenever repair isn't possible: no helper configured,
 * the helper errors, or the helper's own corrected call is still invalid. Callers should
 * fall through to the existing error-handling path in that case.
 */
export async function attemptToolCallRepair(cline: Task, params: RepairToolCallParams): Promise<ToolUse | undefined> {
	const helperHandler = await cline.getErrorRepairApiHandler(params.state)
	if (!helperHandler) {
		return undefined
	}

	const toolDef = getNativeTools().find((tool) => tool.type === "function" && tool.function.name === params.toolName)
	if (!toolDef) {
		return undefined
	}

	const systemPrompt =
		`You are repairing a single malformed tool call. Call the tool "${params.toolName}" exactly once ` +
		`with corrected arguments that satisfy its schema and resolve the validation error below. ` +
		`Do not explain yourself and do not call any other tool.`

	const userMessage = JSON.stringify({
		attemptedCall: params.rawParams,
		error: params.errorMessage,
	})

	const metadata: ApiHandlerCreateMessageMetadata = {
		taskId: cline.taskId,
		tools: [toolDef],
		tool_choice: { type: "function", function: { name: params.toolName } },
		parallelToolCalls: false,
		...(cline.currentRequestAbortController?.signal
			? { abortSignal: cline.currentRequestAbortController.signal }
			: {}),
	}

	let drained: DrainedToolCall | null
	try {
		const stream = helperHandler.createMessage(systemPrompt, [{ role: "user", content: userMessage }], metadata)
		drained = await drainSingleToolCall(stream)
	} catch (error) {
		console.error("[repairToolCall] Helper LLM request failed:", error)
		return undefined
	}

	if (!drained || drained.name !== params.toolName) {
		return undefined
	}

	const parsed = NativeToolCallParser.parseToolCall<ToolName>({
		id: drained.id,
		name: params.toolName,
		arguments: drained.arguments,
	})

	// parseToolCall returns a ToolUse with nativeArgs left undefined (not null) when the
	// corrected call is still missing required params — must be checked explicitly, since
	// a truthy-but-broken ToolUse here would otherwise flow straight into tool dispatch.
	if (!parsed || parsed.type !== "tool_use" || parsed.nativeArgs === undefined) {
		return undefined
	}

	// Preserve the original tool_use_id so the repaired result associates with the
	// tool_use block the main LLM actually produced, not the helper's synthetic call id.
	return { ...parsed, id: params.toolCallId, partial: false }
}
