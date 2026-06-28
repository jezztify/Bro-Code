// pnpm --filter bro-code test core/tools/__tests__/WriteStateTool.spec.ts

import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

import type { AskApproval, HandleError } from "../../../shared/tools"

import { writeStateTool } from "../WriteStateTool"
import { readArtifact } from "../../task-persistence/StateStore"

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

describe("WriteStateTool", () => {
	let tmpDir: string

	beforeEach(async () => {
		vi.clearAllMocks()
		mockAskApproval.mockResolvedValue(true)
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "write-state-tool-test-"))
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it("reports a missing-param error when key is absent", async () => {
		const task = makeMockTask(tmpDir)

		await writeStateTool.execute({ key: "", content: "{}" } as any, task as any, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
		})

		expect(task.recordToolError).toHaveBeenCalledWith("write_state")
		expect(mockAskApproval).not.toHaveBeenCalled()
	})

	it("does not write when approval is declined", async () => {
		mockAskApproval.mockResolvedValue(false)
		const task = makeMockTask(tmpDir)

		await writeStateTool.execute({ key: "plan", content: "{}" }, task as any, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
		})

		expect(await readArtifact(tmpDir, "task-1", "plan")).toBeNull()
		expect(mockPushToolResult).toHaveBeenCalledWith("User declined to write state.")
	})

	it("writes a json artifact under the resolved rootTaskId, defaulting format to json", async () => {
		const task = makeMockTask(tmpDir, { taskId: "child-task", rootTaskId: "root-task" })

		await writeStateTool.execute({ key: "api-contract", content: JSON.stringify({ ok: true }) }, task as any, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
		})

		const artifact = await readArtifact(tmpDir, "root-task", "api-contract")
		expect(artifact?.format).toBe("json")
		expect(JSON.parse(artifact!.content)).toEqual({ ok: true })
		expect(await readArtifact(tmpDir, "child-task", "api-contract")).toBeNull()
	})

	it("writes a markdown artifact when format is markdown", async () => {
		const task = makeMockTask(tmpDir)

		await writeStateTool.execute({ key: "findings", content: "# Notes", format: "markdown" }, task as any, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
		})

		const artifact = await readArtifact(tmpDir, "task-1", "findings")
		expect(artifact?.format).toBe("markdown")
		expect(artifact?.content).toBe("# Notes")
	})

	it("surfaces invalid JSON content as a tool error instead of throwing", async () => {
		const task = makeMockTask(tmpDir)

		await writeStateTool.execute({ key: "plan", content: "not json" }, task as any, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
		})

		expect(task.recordToolError).toHaveBeenCalledWith("write_state")
		expect(mockHandleError).not.toHaveBeenCalled()
		expect(await readArtifact(tmpDir, "task-1", "plan")).toBeNull()
	})
})
