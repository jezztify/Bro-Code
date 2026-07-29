// npx vitest src/core/assistant-message/__tests__/presentAssistantMessage-task-mode.spec.ts

import { describe, it, expect, beforeEach, vi } from "vitest"

import { presentAssistantMessage } from "../presentAssistantMessage"
import type { Task } from "../../task/Task"
import { validateToolUse } from "../../tools/validateToolUse"

vi.mock("../../task/Task")
vi.mock("../../tools/validateToolUse", () => ({
	validateToolUse: vi.fn(),
	isValidToolName: vi.fn(() => true),
}))
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureToolUsage: vi.fn(),
			captureConsecutiveMistakeError: vi.fn(),
		},
	},
}))

/**
 * The tool list handed to the model is built from Task#getTaskMode(). Validation
 * has to check the same mode, or a task created with `initialMode` (a board card's
 * refinement chat) gets offered tools that are then rejected against whatever mode
 * the user happens to have selected globally.
 */
describe("presentAssistantMessage - tool validation mode", () => {
	type MockTask = ReturnType<typeof makeTask>
	let mockTask: MockTask

	const makeTask = (taskMode: string, globalMode: string) => ({
		taskId: "test-task-id",
		instanceId: "test-instance",
		abort: false,
		presentAssistantMessageLocked: false,
		presentAssistantMessageHasPendingUpdates: false,
		currentStreamingContentIndex: 0,
		assistantMessageContent: [] as Record<string, unknown>[],
		userMessageContent: [],
		didCompleteReadingStream: false,
		didRejectTool: false,
		didAlreadyUseTool: false,
		consecutiveMistakeCount: 0,
		clineMessages: [],
		api: { getModel: () => ({ id: "test-model", info: {} }) },
		getTaskMode: vi.fn().mockResolvedValue(taskMode),
		recordToolUsage: vi.fn(),
		recordToolError: vi.fn(),
		toolRepetitionDetector: { check: vi.fn().mockReturnValue({ allowExecution: true }) },
		providerRef: {
			deref: () => ({
				getState: vi.fn().mockResolvedValue({ mode: globalMode, customModes: [] }),
			}),
		},
		say: vi.fn().mockResolvedValue(undefined),
		ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		pushToolResultToUserContent: vi.fn().mockReturnValue(true),
	})

	beforeEach(() => vi.clearAllMocks())

	it("validates against the task's mode, not the globally selected one", async () => {
		mockTask = makeTask("board-refine", "bro-rapid-architect")
		const boardArgs = {
			task_id: "card-1",
			title: "Sharpened title",
			description: "Agreed scope",
			stage: "scoped",
			clear_description: false,
		}
		mockTask.assistantMessageContent = [
			{
				type: "tool_use",
				id: "tool_call_1",
				name: "update_board_task",
				params: boardArgs,
				nativeArgs: boardArgs,
				partial: false,
			},
		]

		// Execution runs past validation and fails on the bare mock; only the mode the
		// tool was validated against matters here.
		await presentAssistantMessage(mockTask as unknown as Task).catch(() => {})

		const [toolName, validatedMode] = vi.mocked(validateToolUse).mock.calls[0]
		expect(toolName).toBe("update_board_task")
		expect(validatedMode).toBe("board-refine")
	})

	it("is unchanged for a task whose mode matches the global selection", async () => {
		mockTask = makeTask("code", "code")
		mockTask.assistantMessageContent = [
			{
				type: "tool_use",
				id: "tool_call_1",
				name: "read_file",
				params: { args: "<file><path>a.ts</path></file>" },
				nativeArgs: { files: [{ path: "a.ts" }] },
				partial: false,
			},
		]

		// Execution runs past validation and fails on the bare mock; only the mode the
		// tool was validated against matters here.
		await presentAssistantMessage(mockTask as unknown as Task).catch(() => {})

		const [toolName, validatedMode] = vi.mocked(validateToolUse).mock.calls[0]
		expect(toolName).toBe("read_file")
		expect(validatedMode).toBe("code")
	})
})
