import { describe, expect, it } from "vitest"
import { mkdtemp, readFile, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

import { BoardStore } from "../BoardStore"

describe("BoardStore", () => {
	it("persists an empty-title task in its selected logical workspace", async () => {
		const directory = await mkdtemp(join(tmpdir(), "board-store-"))
		const store = new BoardStore(directory)
		await store.initialize()
		await store.createWorkspace("Planning")
		const workspaceId = store.getSnapshot().selectedWorkspaceId!
		await store.createTask({ workspaceId, stage: "approved" })
		const snapshot = store.getSnapshot()
		expect(snapshot.tasks).toHaveLength(1)
		expect(snapshot.tasks[0]).toMatchObject({ workspaceId, title: "", stage: "approved", position: 0 })
		expect(JSON.parse(await readFile(join(directory, "board.json"), "utf8"))).toMatchObject({ selectedWorkspaceId: workspaceId })
	})

	it("persists a mode per column and clears it again", async () => {
		const directory = await mkdtemp(join(tmpdir(), "board-store-"))
		const store = new BoardStore(directory)
		await store.initialize()
		await store.createWorkspace("Planning")
		const workspaceId = store.getSnapshot().selectedWorkspaceId!

		await store.setColumnMode(workspaceId, "approved", "code")
		await store.setColumnMode(workspaceId, "backlog", "architect")
		expect(store.getSnapshot().workspaces[0]?.columnModes).toEqual({ approved: "code", backlog: "architect" })

		const reopened = new BoardStore(directory)
		await reopened.initialize()
		expect(reopened.getSnapshot().workspaces[0]?.columnModes).toEqual({ approved: "code", backlog: "architect" })

		await reopened.setColumnMode(workspaceId, "approved", null)
		expect(reopened.getSnapshot().workspaces[0]?.columnModes).toEqual({ backlog: "architect" })
	})

	it("imports top-level history only once", async () => {
		const directory = await mkdtemp(join(tmpdir(), "board-store-"))
		const store = new BoardStore(directory)
		await store.initialize()
		const history = [
			{ id: "root", number: 1, ts: 1, task: "Root", tokensIn: 0, tokensOut: 0, totalCost: 0, status: "completed" as const },
			{ id: "child", parentTaskId: "root", number: 2, ts: 2, task: "Child", tokensIn: 0, tokensOut: 0, totalCost: 0 },
		]
		await store.importHistoryOnce(history)
		await store.importHistoryOnce(history)
		expect(store.getSnapshot().tasks).toHaveLength(1)
		expect(store.getSnapshot().tasks[0]).toMatchObject({ title: "Root", stage: "done", linkedHistoryTaskId: "root" })
	})

	it("numbers cards across every workspace so a TASK number identifies one card", async () => {
		const directory = await mkdtemp(join(tmpdir(), "board-store-"))
		const store = new BoardStore(directory)
		await store.initialize()
		await store.createWorkspace("Planning")
		const planningId = store.getSnapshot().selectedWorkspaceId!
		await store.createWorkspace("Shipping")
		const shippingId = store.getSnapshot().selectedWorkspaceId!

		await store.createTask({ workspaceId: planningId, title: "First" })
		await store.createTask({ workspaceId: shippingId, title: "Second" })

		expect(store.getSnapshot().tasks.map((task) => [task.title, task.number])).toEqual([
			["First", 1],
			["Second", 2],
		])

		// A deleted card's number is retired rather than handed to the next card.
		await store.deleteTask(store.getSnapshot().tasks[1]!.id)
		await store.createTask({ workspaceId: shippingId, title: "Third" })
		expect(store.getSnapshot().tasks.at(-1)).toMatchObject({ title: "Third", number: 3 })

		const reopened = new BoardStore(directory)
		await reopened.initialize()
		await reopened.createTask({ workspaceId: planningId, title: "Fourth" })
		expect(reopened.getSnapshot().tasks.at(-1)).toMatchObject({ title: "Fourth", number: 4 })
	})

	it("numbers cards saved before numbering existed, oldest first", async () => {
		const directory = await mkdtemp(join(tmpdir(), "board-store-"))
		const now = Date.now()
		const workspace = { id: "workspace-1", name: "Planning", createdAt: now, updatedAt: now }
		const task = (id: string, createdAt: number) => ({
			id,
			workspaceId: workspace.id,
			title: id,
			stage: "backlog" as const,
			position: 0,
			createdAt,
			updatedAt: now,
		})
		await writeFile(
			join(directory, "board.json"),
			JSON.stringify({
				version: 1,
				selectedWorkspaceId: workspace.id,
				workspaces: [workspace],
				tasks: [task("newer", now), task("older", now - 1000)],
				migrations: {},
			}),
		)

		const store = new BoardStore(directory)
		await store.initialize()

		expect(store.getSnapshot().tasks.map((entry) => [entry.id, entry.number])).toEqual([
			["newer", 2],
			["older", 1],
		])
		// The backfill is written back, so the numbers a user sees never shift on reload.
		const reopened = new BoardStore(directory)
		await reopened.initialize()
		await reopened.createTask({ workspaceId: workspace.id, title: "Next" })
		expect(reopened.getSnapshot().tasks.at(-1)).toMatchObject({ title: "Next", number: 3 })
	})

	it("persists a workspace folder link change and clear across reopen", async () => {
		const directory = await mkdtemp(join(tmpdir(), "board-store-"))
		const store = new BoardStore(directory)
		await store.initialize()
		await store.createWorkspace("Planning", "/workspace-a")
		const workspaceId = store.getSnapshot().selectedWorkspaceId!

		await store.updateWorkspace(workspaceId, { linkedWorkspacePath: "/workspace-b" })
		expect(store.getSnapshot().workspaces[0]?.linkedWorkspacePath).toBe("/workspace-b")

		await store.updateWorkspace(workspaceId, { linkedWorkspacePath: "" })
		expect(store.getSnapshot().workspaces[0]?.linkedWorkspacePath).toBeUndefined()

		const reopenedStore = new BoardStore(directory)
		await reopenedStore.initialize()
		expect(reopenedStore.getSnapshot().workspaces[0]).toMatchObject({ id: workspaceId, name: "Planning" })
		expect(reopenedStore.getSnapshot().workspaces[0]?.linkedWorkspacePath).toBeUndefined()
	})

	const seedTask = async (stage: "backlog" | "approved" = "approved") => {
		const directory = await mkdtemp(join(tmpdir(), "board-store-"))
		const store = new BoardStore(directory)
		await store.initialize()
		await store.createWorkspace("Planning")
		const workspaceId = store.getSnapshot().selectedWorkspaceId!
		await store.createTask({ workspaceId, title: "Implement", stage })
		return { store, taskId: store.getSnapshot().tasks[0]!.id }
	}

	it("moves a card to in progress when an execution task is linked", async () => {
		const { store, taskId } = await seedTask()

		await store.linkTaskToHistory(taskId, "execution-1")

		expect(store.getSnapshot().tasks[0]).toMatchObject({
			stage: "in_progress",
			linkedHistoryTaskId: "execution-1",
		})
	})

	it("rejects linking a second execution task to the same card", async () => {
		const { store, taskId } = await seedTask()
		await store.linkTaskToHistory(taskId, "execution-1")

		await expect(store.linkTaskToHistory(taskId, "execution-2")).rejects.toThrow(/already linked/)
	})

	it("links a refinement chat without disturbing the stage or the execution link", async () => {
		const { store, taskId } = await seedTask("backlog")

		await store.linkRefinementTask(taskId, "refine-1")

		expect(store.getSnapshot().tasks[0]).toMatchObject({
			stage: "backlog",
			linkedRefinementTaskId: "refine-1",
		})
		expect(store.getSnapshot().tasks[0]?.linkedHistoryTaskId).toBeUndefined()
		await expect(store.linkRefinementTask(taskId, "refine-2")).rejects.toThrow(/already linked/)
	})

	it("returns a card to approved and clears the execution link when stopped", async () => {
		const { store, taskId } = await seedTask()
		await store.linkRefinementTask(taskId, "refine-1")
		await store.linkTaskToHistory(taskId, "execution-1")

		await store.unlinkExecutionTask(taskId)

		expect(store.getSnapshot().tasks[0]).toMatchObject({ stage: "approved" })
		expect(store.getSnapshot().tasks[0]?.linkedHistoryTaskId).toBeUndefined()
		// The refinement chat survives a stopped run so the card can still be reopened.
		expect(store.getSnapshot().tasks[0]?.linkedRefinementTaskId).toBe("refine-1")
		// The card is startable again.
		await expect(store.linkTaskToHistory(taskId, "execution-2")).resolves.toBeDefined()
	})

	it("does not move a card to done when its refinement chat completes", async () => {
		const { store, taskId } = await seedTask("backlog")
		await store.linkRefinementTask(taskId, "refine-1")

		await store.moveLinkedHistoryTaskToDone("refine-1")

		expect(store.getSnapshot().tasks[0]).toMatchObject({ stage: "backlog" })
	})

	it("promotes a backlog card to scoped when its refinement chat completes", async () => {
		const { store, taskId } = await seedTask("backlog")
		await store.linkRefinementTask(taskId, "refine-1")

		await store.moveLinkedRefinementTaskToScoped("refine-1")

		expect(store.getSnapshot().tasks[0]).toMatchObject({ stage: "scoped" })
	})

	it("leaves a card alone when the refiner already moved it past backlog", async () => {
		const { store, taskId } = await seedTask("backlog")
		await store.linkRefinementTask(taskId, "refine-1")
		// The refiner scoped it itself, then the user approved it.
		await store.updateTask(taskId, { stage: "approved" })

		await store.moveLinkedRefinementTaskToScoped("refine-1")

		expect(store.getSnapshot().tasks[0]).toMatchObject({ stage: "approved" })
	})

	it("only promotes the card whose refinement chat completed", async () => {
		const { store, taskId } = await seedTask("backlog")
		const workspaceId = store.getSnapshot().tasks[0]!.workspaceId
		await store.createTask({ workspaceId, title: "Other", stage: "backlog" })
		const otherId = store.getSnapshot().tasks[1]!.id
		await store.linkRefinementTask(taskId, "refine-1")
		await store.linkRefinementTask(otherId, "refine-2")

		await store.moveLinkedRefinementTaskToScoped("refine-1")

		const tasks = store.getSnapshot().tasks
		expect(tasks.find((task) => task.id === taskId)?.stage).toBe("scoped")
		expect(tasks.find((task) => task.id === otherId)?.stage).toBe("backlog")
	})

	it("does not promote a card from an execution task completing", async () => {
		const { store, taskId } = await seedTask("backlog")
		await store.linkRefinementTask(taskId, "refine-1")

		await store.moveLinkedRefinementTaskToScoped("some-execution-task")

		expect(store.getSnapshot().tasks[0]).toMatchObject({ stage: "backlog" })
	})

	it("persists the refinement link across reopen", async () => {
		const directory = await mkdtemp(join(tmpdir(), "board-store-"))
		const store = new BoardStore(directory)
		await store.initialize()
		await store.createWorkspace("Planning")
		const workspaceId = store.getSnapshot().selectedWorkspaceId!
		await store.createTask({ workspaceId, title: "Implement" })
		await store.linkRefinementTask(store.getSnapshot().tasks[0]!.id, "refine-1")

		const reopenedStore = new BoardStore(directory)
		await reopenedStore.initialize()

		expect(reopenedStore.getSnapshot().tasks[0]).toMatchObject({ linkedRefinementTaskId: "refine-1" })
	})
})
