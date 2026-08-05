// npx vitest src/core/tools/__tests__/boardReviewRunLock.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"

import type { BoardState, BoardTask } from "@roo-code/types"

import type { Task } from "../../task/Task"
import type { ToolUse } from "../../../shared/tools"
import { switchModeTool } from "../SwitchModeTool"
import { newTaskTool } from "../NewTaskTool"
import { askFollowupQuestionTool } from "../AskFollowupQuestionTool"
import { runSlashCommandTool } from "../RunSlashCommandTool"
import { getCommand, getCommandNames } from "../../../services/command/commands"

vi.mock("delay", () => ({ default: vi.fn().mockResolvedValue(undefined) }))
vi.mock("../../../services/command/commands", () => ({ getCommand: vi.fn(), getCommandNames: vi.fn() }))
vi.mock("vscode", () => ({
	workspace: { getConfiguration: () => ({ get: () => false }) },
}))

/**
 * The escape a board refinement run took in the wild: launched in `board-refine`, which
 * has no `edit` group, it reached `code` anyway and wrote three files onto a card that
 * was still sitting in the backlog. `switch_mode`, `new_task` and `run_slash_command` are
 * always available whatever the mode says, and `ask_followup_question` suggestions carry
 * a mode that switches when the user clicks one — so none of them may move a run the
 * board launched to look at work rather than do it.
 */
describe("board review runs are pinned to their column's mode", () => {
	const card: BoardTask = {
		id: "card-1",
		workspaceId: "workspace-1",
		title: "Establish code base",
		stage: "backlog",
		position: 0,
		createdAt: 0,
		updatedAt: 0,
		linkedRefinementTaskId: "refine-1",
	}

	const board: BoardState = { version: 1, workspaces: [], tasks: [card], migrations: {} }

	let handleModeSwitch: ReturnType<typeof vi.fn>

	/** @param taskId `refine-1` is the card's refinement chat; anything else is an ordinary one. */
	const buildTask = (taskId: string) => {
		handleModeSwitch = vi.fn().mockResolvedValue(undefined)

		return {
			taskId,
			consecutiveMistakeCount: 0,
			didToolFailInCurrentTurn: false,
			clineMessages: [],
			todoList: [],
			cwd: "/test/project",
			recordToolError: vi.fn(),
			recordToolUsage: vi.fn(),
			overwriteClineMessages: vi.fn().mockResolvedValue(undefined),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing parameter error"),
			say: vi.fn().mockResolvedValue(undefined),
			ask: vi.fn().mockResolvedValue({ text: "ok", images: undefined }),
			getTaskMode: vi.fn().mockResolvedValue("board-refine"),
			providerRef: {
				deref: vi.fn().mockReturnValue({
					boardStore: { getSnapshot: () => board },
					handleModeSwitch,
					getSkillsManager: vi.fn().mockReturnValue(undefined),
					getState: vi.fn().mockResolvedValue({
						customModes: [],
						experiments: { runSlashCommand: true },
					}),
					delegateParentAndOpenChild: vi.fn().mockResolvedValue({ taskId: "child-1" }),
				}),
			},
		}
	}

	const buildCallbacks = () => ({
		askApproval: vi.fn().mockResolvedValue(true),
		handleError: vi.fn(),
		pushToolResult: vi.fn(),
	})

	let mockTask: ReturnType<typeof buildTask>
	let mockCallbacks: ReturnType<typeof buildCallbacks>

	beforeEach(() => {
		vi.clearAllMocks()
		mockTask = buildTask("refine-1")
		mockCallbacks = buildCallbacks()
	})

	describe("switch_mode", () => {
		const block = {
			type: "tool_use" as const,
			name: "switch_mode" as const,
			params: { mode_slug: "code", reason: "to implement it" },
			partial: false,
			nativeArgs: { mode_slug: "code", reason: "to implement it" },
		} as unknown as ToolUse<"switch_mode">

		it("is refused in a refinement chat", async () => {
			await switchModeTool.handle(mockTask as unknown as Task, block, mockCallbacks)

			expect(handleModeSwitch).not.toHaveBeenCalled()
			expect(mockTask.recordToolError).toHaveBeenCalledWith("switch_mode")
			expect(mockTask.didToolFailInCurrentTurn).toBe(true)
			expect(mockCallbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("has not been approved"))
		})

		// Auto-approve is what carried the switch through in the wild, so the refusal has
		// to land before anything is put to the user at all.
		it("is refused without ever asking for approval", async () => {
			await switchModeTool.handle(mockTask as unknown as Task, block, mockCallbacks)

			expect(mockCallbacks.askApproval).not.toHaveBeenCalled()
		})

		it("still works in an ordinary chat", async () => {
			await switchModeTool.handle(buildTask("chat-1") as unknown as Task, block, mockCallbacks)

			expect(handleModeSwitch).toHaveBeenCalledWith("code", expect.anything())
		})
	})

	describe("new_task", () => {
		const block = {
			type: "tool_use" as const,
			name: "new_task" as const,
			params: { mode: "code", message: "Build the skeleton" },
			partial: false,
			nativeArgs: { mode: "code", message: "Build the skeleton" },
		} as unknown as ToolUse<"new_task">

		// A subtask needs no mode switch at all: the child runs in whatever mode it was
		// handed and writes what its parent cannot.
		it("is refused in a refinement chat", async () => {
			await newTaskTool.handle(mockTask as unknown as Task, block, mockCallbacks)

			expect(mockTask.providerRef.deref().delegateParentAndOpenChild).not.toHaveBeenCalled()
			expect(mockCallbacks.askApproval).not.toHaveBeenCalled()
			expect(mockCallbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("new_task"))
		})

		it("still works in an ordinary chat", async () => {
			const ordinary = buildTask("chat-1")

			await newTaskTool.handle(ordinary as unknown as Task, block, mockCallbacks)

			expect(ordinary.providerRef.deref().delegateParentAndOpenChild).toHaveBeenCalled()
		})
	})

	describe("ask_followup_question", () => {
		const block = {
			type: "tool_use" as const,
			name: "ask_followup_question" as const,
			params: {},
			partial: false,
			nativeArgs: {
				question: "What should the skeleton deliver?",
				follow_up: [
					{ text: "Only empty stubs plus one working system", mode: "code" },
					{ text: "Just the file structure", mode: "architect" },
				],
			},
		} as unknown as ToolUse<"ask_followup_question">

		const suggestionsFrom = (task: ReturnType<typeof buildTask>) =>
			JSON.parse(task.ask.mock.calls.at(-1)![1] as string).suggest as Array<{
				answer: string
				mode?: string
			}>

		// This is the one that actually fired: the user answered a scoping question by
		// clicking a suggestion, and the mode riding on it took the run into `code`.
		it("keeps the suggestions but drops the modes attached to them", async () => {
			await askFollowupQuestionTool.handle(mockTask as unknown as Task, block, mockCallbacks)

			const suggestions = suggestionsFrom(mockTask)
			expect(suggestions.map((suggestion) => suggestion.answer)).toEqual([
				"Only empty stubs plus one working system",
				"Just the file structure",
			])
			expect(suggestions.every((suggestion) => suggestion.mode === undefined)).toBe(true)
		})

		it("still offers modes in an ordinary chat", async () => {
			const ordinary = buildTask("chat-1")

			await askFollowupQuestionTool.handle(ordinary as unknown as Task, block, mockCallbacks)

			expect(suggestionsFrom(ordinary).map((suggestion) => suggestion.mode)).toEqual(["code", "architect"])
		})
	})

	describe("run_slash_command", () => {
		const block = {
			type: "tool_use" as const,
			name: "run_slash_command" as const,
			params: {},
			partial: false,
			nativeArgs: { command: "implement" },
		} as unknown as ToolUse<"run_slash_command">

		beforeEach(() => {
			vi.mocked(getCommandNames).mockResolvedValue(["implement"])
			vi.mocked(getCommand).mockResolvedValue({
				name: "implement",
				content: "Write the code.",
				source: "project",
				filePath: "/test/project/.roo/commands/implement.md",
				mode: "code",
			})
		})

		// The command's own instructions are worth having; the mode that came attached to
		// it is the same escape switch_mode would have been.
		it("runs the command but does not take the mode with it", async () => {
			await runSlashCommandTool.handle(mockTask as unknown as Task, block, mockCallbacks)

			expect(handleModeSwitch).not.toHaveBeenCalled()
			expect(mockCallbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Write the code."))
			// The result must not report a switch that never happened.
			expect(mockCallbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("not switched"))
		})

		it("still switches in an ordinary chat", async () => {
			await runSlashCommandTool.handle(buildTask("chat-1") as unknown as Task, block, mockCallbacks)

			expect(handleModeSwitch).toHaveBeenCalledWith("code", expect.anything())
		})
	})
})
