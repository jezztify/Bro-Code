// pnpm --filter bro-code test core/tools/__tests__/ReadStateTool.spec.ts

import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

import type { AskApproval, HandleError } from "../../../shared/tools"

import { readStateTool } from "../ReadStateTool"
import { writeArtifact } from "../../task-persistence/StateStore"

const mockAskApproval = vi.fn<AskApproval>()
const mockHandleError = vi.fn<HandleError>()
const mockPushToolResult = vi.fn()
const mockSayAndCreateMissingParamError = vi.fn(
	async (tool: string, param: string) => `Missing param ${param} for ${tool}`,
)

function makeMockTask(cwd: string, overrides: Record<string, unknown> = {}) {
	return {
		cwd,
		taskId: "task-1",
		rootTaskId: undefined,
		consecutiveMistakeCount: 0,
		didToolFailInCurrentTurn: false,
		recordToolError: vi.fn(),
		sayAndCreateMissingParamError: mockSayAndCreateMissingParamError,
		...overrides,
	}
}

describe("ReadStateTool", () => {
	let tmpDir: string

	beforeEach(async () => {
		vi.clearAllMocks()
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "read-state-tool-test-"))
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it("reports a missing-param error when key is absent", async () => {
		const task = makeMockTask(tmpDir)

		await readStateTool.execute({ key: "" } as any, task as any, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
		})

		expect(task.recordToolError).toHaveBeenCalledWith("read_state")
		expect(mockPushToolResult).toHaveBeenCalledWith("Missing param key for read_state")
	})

	it("returns a not-found message when the key was never written", async () => {
		const task = makeMockTask(tmpDir)

		await readStateTool.execute({ key: "missing" }, task as any, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
		})

		expect(mockPushToolResult).toHaveBeenCalledWith(
			expect.stringContaining('No state artifact found for key "missing"'),
		)
	})

	it("reads back content written via the StateStore", async () => {
		await writeArtifact(tmpDir, "task-1", "plan", JSON.stringify({ steps: ["a"] }), "json")
		const task = makeMockTask(tmpDir)

		await readStateTool.execute({ key: "plan" }, task as any, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
		})

		expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining('{"steps":["a"]}'))
	})

	it("reads under the resolved rootTaskId, not the subtask's own taskId", async () => {
		await writeArtifact(tmpDir, "root-task", "api-contract", JSON.stringify({ ok: true }), "json")
		const task = makeMockTask(tmpDir, { taskId: "child-task", rootTaskId: "root-task" })

		await readStateTool.execute({ key: "api-contract" }, task as any, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
		})

		expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining('{"ok":true}'))
	})

	it("surfaces an invalid key as a tool error instead of throwing", async () => {
		const task = makeMockTask(tmpDir)

		await readStateTool.execute({ key: "../escape" }, task as any, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
		})

		expect(task.recordToolError).toHaveBeenCalledWith("read_state")
		expect(mockHandleError).not.toHaveBeenCalled()
		expect(mockPushToolResult).toHaveBeenCalled()
	})
})
