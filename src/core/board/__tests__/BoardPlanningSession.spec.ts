import { mkdtemp } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

import { describe, expect, it, vi } from "vitest"

import { BoardPlanningSession } from "../BoardPlanningSession"
import { BoardStore } from "../BoardStore"

describe("BoardPlanningSession", () => {
	it("requires approval and only mutates its active workspace", async () => {
		const store = new BoardStore(await mkdtemp(join(tmpdir(), "board-planning-")))
		await store.initialize()
		await store.createWorkspace("A", "/workspace-a")
		const workspaceA = store.getSnapshot().workspaces[0]
		await store.createWorkspace("B")
		const workspaceB = store.getSnapshot().workspaces[1]
		const publish = vi.fn().mockResolvedValue(undefined)
		const session = new BoardPlanningSession(store, workspaceA, publish)

		expect(session.state).toMatchObject({
			workspaceId: workspaceA.id,
			linkedWorkspacePath: "/workspace-a",
			approvalRequired: true,
			approved: false,
		})
		await expect(
			session.dispatch("create_board_task", { title: "Blocked", description: null, stage: "backlog" }),
		).rejects.toThrow("explicit user approval")
		expect(store.getSnapshot().tasks).toHaveLength(0)
		;(session as any).pendingCalls.push({
			name: "create_board_task",
			arguments: JSON.stringify({ title: "Plan task", description: null, stage: "scoped" }),
		})
		session.state.status = "awaiting_approval"
		await session.approve()
		const task = store.getSnapshot().tasks[0]
		expect(task).toMatchObject({ workspaceId: workspaceA.id, title: "Plan task", stage: "scoped" })
		await expect(
			session.dispatch("update_board_task", {
				taskId: task.id,
				title: null,
				description: null,
				stage: "invalid",
			}),
		).rejects.toThrow("Invalid board stage")
		await expect(
			session.dispatch("update_board_task", {
				taskId: workspaceB.id,
				title: "Other",
				description: null,
				stage: null,
			}),
		).rejects.toThrow("not in this planning workspace")
		expect(store.getSnapshot().tasks).toHaveLength(1)
	})
})
