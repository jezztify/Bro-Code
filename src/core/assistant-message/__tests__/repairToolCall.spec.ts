// npx vitest src/core/assistant-message/__tests__/repairToolCall.spec.ts

import { describe, it, expect, vi } from "vitest"
import { attemptToolCallRepair } from "../repairToolCall"
import type { ApiStreamChunk } from "../../../api/transform/stream"

async function* streamOf(chunks: ApiStreamChunk[]) {
	for (const chunk of chunks) {
		yield chunk
	}
}

function makeCline(helperHandler: unknown) {
	return {
		taskId: "test-task-id",
		currentRequestAbortController: undefined,
		getErrorRepairApiHandler: vi.fn().mockResolvedValue(helperHandler),
	} as any
}

const baseParams = {
	toolName: "list_files" as const,
	toolCallId: "original-tool-use-id",
	rawParams: { path: "src" },
	errorMessage: "Invalid tool call for 'list_files': missing required parameter(s): recursive.",
	state: undefined,
}

describe("attemptToolCallRepair", () => {
	it("returns undefined and makes no API call when no helper is configured", async () => {
		const cline = makeCline(undefined)

		const result = await attemptToolCallRepair(cline, baseParams)

		expect(result).toBeUndefined()
		expect(cline.getErrorRepairApiHandler).toHaveBeenCalledTimes(1)
	})

	it("returns a corrected ToolUse from a complete tool_call chunk", async () => {
		const createMessage = vi.fn().mockReturnValue(
			streamOf([
				{
					type: "tool_call",
					id: "helper-call-1",
					name: "list_files",
					arguments: JSON.stringify({ path: "src", recursive: false }),
				},
			]),
		)
		const cline = makeCline({ createMessage })

		const result = await attemptToolCallRepair(cline, baseParams)

		expect(result).toBeDefined()
		expect(result?.type).toBe("tool_use")
		expect(result?.partial).toBe(false)
		// Original tool_use_id must be preserved, not the helper's synthetic id.
		expect(result?.id).toBe("original-tool-use-id")
		expect(result?.nativeArgs).toEqual({ path: "src", recursive: false })
	})

	it("returns a corrected ToolUse assembled from tool_call_partial chunks", async () => {
		const createMessage = vi.fn().mockReturnValue(
			streamOf([
				{
					type: "tool_call_partial",
					index: 0,
					id: "helper-call-2",
					name: "list_files",
					arguments: '{"path":"src",',
				},
				{ type: "tool_call_partial", index: 0, arguments: '"recursive":true}' },
			]),
		)
		const cline = makeCline({ createMessage })

		const result = await attemptToolCallRepair(cline, baseParams)

		expect(result).toBeDefined()
		expect(result?.nativeArgs).toEqual({ path: "src", recursive: true })
		expect(result?.id).toBe("original-tool-use-id")
	})

	it("returns undefined when the helper's corrected call is still missing required params", async () => {
		const createMessage = vi.fn().mockReturnValue(
			streamOf([
				{
					type: "tool_call",
					id: "helper-call-3",
					name: "list_files",
					arguments: JSON.stringify({ recursive: false }), // missing required "path"
				},
			]),
		)
		const cline = makeCline({ createMessage })

		const result = await attemptToolCallRepair(cline, baseParams)

		expect(result).toBeUndefined()
	})

	it("returns undefined when the helper stream errors", async () => {
		const createMessage = vi.fn().mockReturnValue(streamOf([{ type: "error", error: "boom", message: "boom" }]))
		const cline = makeCline({ createMessage })

		const result = await attemptToolCallRepair(cline, baseParams)

		expect(result).toBeUndefined()
	})

	it("returns undefined and does not throw when createMessage itself throws", async () => {
		const createMessage = vi.fn().mockImplementation(() => {
			throw new Error("network error")
		})
		const cline = makeCline({ createMessage })

		await expect(attemptToolCallRepair(cline, baseParams)).resolves.toBeUndefined()
	})

	it("returns undefined when the helper responds with a different tool than requested", async () => {
		const createMessage = vi.fn().mockReturnValue(
			streamOf([
				{
					type: "tool_call",
					id: "helper-call-4",
					name: "read_file",
					arguments: JSON.stringify({ path: "src/index.ts" }),
				},
			]),
		)
		const cline = makeCline({ createMessage })

		const result = await attemptToolCallRepair(cline, baseParams)

		expect(result).toBeUndefined()
	})
})
