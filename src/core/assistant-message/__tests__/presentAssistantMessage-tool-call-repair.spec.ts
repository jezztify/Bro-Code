// npx vitest src/core/assistant-message/__tests__/presentAssistantMessage-tool-call-repair.spec.ts

import { describe, it, expect, beforeEach, vi } from "vitest"
import { presentAssistantMessage } from "../presentAssistantMessage"
import { attemptToolCallRepair } from "../repairToolCall"
import { listFilesTool } from "../../tools/ListFilesTool"

vi.mock("../../task/Task")
vi.mock("../repairToolCall", () => ({
	attemptToolCallRepair: vi.fn(),
}))
vi.mock("../../tools/ListFilesTool", () => ({
	listFilesTool: { handle: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock("../../tools/validateToolUse", () => ({
	validateToolUse: vi.fn(),
	isValidToolName: vi.fn(() => true),
}))
vi.mock("@bro-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureToolUsage: vi.fn(),
			captureConsecutiveMistakeError: vi.fn(),
			captureEvent: vi.fn(),
		},
	},
}))

describe("presentAssistantMessage - tool call repair", () => {
	let mockTask: any
	const toolCallId = "tool_call_repair_test"

	beforeEach(() => {
		vi.mocked(attemptToolCallRepair).mockReset()
		vi.mocked(listFilesTool.handle).mockClear()

		mockTask = {
			taskId: "test-task-id",
			instanceId: "test-instance",
			abort: false,
			presentAssistantMessageLocked: false,
			presentAssistantMessageHasPendingUpdates: false,
			currentStreamingContentIndex: 0,
			assistantMessageContent: [
				{
					type: "tool_use",
					id: toolCallId,
					name: "list_files",
					params: { path: "src" },
					nativeArgs: undefined,
					partial: false,
				},
			],
			userMessageContent: [],
			didCompleteReadingStream: false,
			didRejectTool: false,
			didAlreadyUseTool: false,
			consecutiveMistakeCount: 0,
			clineMessages: [],
			api: {
				getModel: () => ({ id: "test-model", info: {} }),
			},
			recordToolUsage: vi.fn(),
			recordToolError: vi.fn(),
			toolRepetitionDetector: {
				check: vi.fn().mockReturnValue({ allowExecution: true }),
			},
			providerRef: {
				deref: () => ({
					getState: vi.fn().mockResolvedValue({
						mode: "code",
						customModes: [],
					}),
				}),
			},
			say: vi.fn().mockResolvedValue(undefined),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		}

		mockTask.pushToolResultToUserContent = vi.fn().mockImplementation((toolResult: any) => {
			const existingResult = mockTask.userMessageContent.find(
				(block: any) => block.type === "tool_result" && block.tool_use_id === toolResult.tool_use_id,
			)
			if (existingResult) {
				return false
			}
			mockTask.userMessageContent.push(toolResult)
			return true
		})
	})

	it("on repair success, uses the corrected call, does not increment consecutiveMistakeCount, and does not push an error result", async () => {
		const repairedBlock = {
			type: "tool_use",
			id: toolCallId,
			name: "list_files",
			params: { path: "src", recursive: "false" },
			nativeArgs: { path: "src", recursive: false },
			partial: false,
		}
		vi.mocked(attemptToolCallRepair).mockResolvedValue(repairedBlock as any)

		await presentAssistantMessage(mockTask)

		expect(attemptToolCallRepair).toHaveBeenCalledWith(
			mockTask,
			expect.objectContaining({ toolName: "list_files", toolCallId, rawParams: { path: "src" } }),
		)
		expect(mockTask.consecutiveMistakeCount).toBe(0)
		expect(mockTask.recordToolError).not.toHaveBeenCalled()

		const errorResult = mockTask.userMessageContent.find(
			(item: any) => item.type === "tool_result" && item.tool_use_id === toolCallId && item.is_error,
		)
		expect(errorResult).toBeUndefined()

		// The corrected block reached the normal tool dispatch.
		expect(listFilesTool.handle).toHaveBeenCalledTimes(1)
		const [, dispatchedBlock] = vi.mocked(listFilesTool.handle).mock.calls[0]
		expect(dispatchedBlock.nativeArgs).toEqual({ path: "src", recursive: false })
	})

	it("on repair failure, behaves exactly like the pre-repair baseline", async () => {
		vi.mocked(attemptToolCallRepair).mockResolvedValue(undefined)

		await presentAssistantMessage(mockTask)

		expect(mockTask.consecutiveMistakeCount).toBe(1)
		expect(mockTask.recordToolError).toHaveBeenCalledWith("list_files", expect.stringContaining("list_files"))

		const errorResult = mockTask.userMessageContent.find(
			(item: any) => item.type === "tool_result" && item.tool_use_id === toolCallId,
		)
		expect(errorResult).toBeDefined()
		expect(errorResult.is_error).toBe(true)

		expect(listFilesTool.handle).not.toHaveBeenCalled()
	})
})
