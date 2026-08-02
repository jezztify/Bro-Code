import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, readFile, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

import { BOARD_ACTIVITY_LIMIT } from "@roo-code/types"

import { BoardStore, type BoardTaskMove } from "../BoardStore"

describe("BoardStore", () => {
	// The notifier is host-wide state, so a test that installs one must not leave it
	// listening to the next test's board.
	afterEach(() => BoardStore.setMoveNotifier(undefined))

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
		expect(JSON.parse(await readFile(join(directory, "board.json"), "utf8"))).toMatchObject({
			selectedWorkspaceId: workspaceId,
		})
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
			{
				id: "root",
				number: 1,
				ts: 1,
				task: "Root",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				status: "completed" as const,
			},
			{
				id: "child",
				parentTaskId: "root",
				number: 2,
				ts: 2,
				task: "Child",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			},
		]
		await store.importHistoryOnce(history)
		await store.importHistoryOnce(history)
		expect(store.getSnapshot().tasks).toHaveLength(1)
		expect(store.getSnapshot().tasks[0]).toMatchObject({
			title: "Root",
			stage: "done",
			linkedHistoryTaskId: "root",
		})
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
		await store.linkValidationTask(taskId, "validate-1")

		await store.unlinkExecutionTask(taskId)

		expect(store.getSnapshot().tasks[0]).toMatchObject({ stage: "approved" })
		expect(store.getSnapshot().tasks[0]?.linkedHistoryTaskId).toBeUndefined()
		// The abandoned implementation's validation goes with it, so the restarted card
		// gets checked afresh rather than reopening a verdict on work that was thrown away.
		expect(store.getSnapshot().tasks[0]?.linkedValidationTaskId).toBeUndefined()
		// The refinement chat survives a stopped run so the card can still be reopened.
		expect(store.getSnapshot().tasks[0]?.linkedRefinementTaskId).toBe("refine-1")
		// The card is startable again.
		await expect(store.linkTaskToHistory(taskId, "execution-2")).resolves.toBeDefined()
	})

	it("does not move a card to qa validation when its refinement chat completes", async () => {
		const { store, taskId } = await seedTask("backlog")
		await store.linkRefinementTask(taskId, "refine-1")

		await store.moveLinkedHistoryTaskToQaValidation("refine-1")

		expect(store.getSnapshot().tasks[0]).toMatchObject({ stage: "backlog" })
	})

	it("hands a completed execution run to qa validation rather than straight to done", async () => {
		const { store, taskId } = await seedTask()
		await store.linkTaskToHistory(taskId, "execution-1")

		await store.moveLinkedHistoryTaskToQaValidation("execution-1")

		expect(store.getSnapshot().tasks[0]).toMatchObject({ stage: "qa_validation" })
	})

	it("sends a card the validator returned back for validation once the fixes finish", async () => {
		const { store, taskId } = await seedTask()
		await store.linkTaskToHistory(taskId, "execution-1")
		await store.moveLinkedHistoryTaskToQaValidation("execution-1")
		await store.linkValidationTask(taskId, "validate-1")
		// The validator found unmet criteria and returned the card for more work.
		await store.updateTask(taskId, { stage: "in_progress" })

		await store.moveLinkedHistoryTaskToQaValidation("execution-1")

		expect(store.getSnapshot().tasks[0]).toMatchObject({ stage: "qa_validation" })
		// The fixed implementation needs checking afresh, not the previous verdict's chat.
		expect(store.getSnapshot().tasks[0]?.linkedValidationTaskId).toBeUndefined()
	})

	it("reports every kind of move, and only moves, to the notifier", async () => {
		const moves: Array<{ from: string; to: string }> = []
		BoardStore.setMoveNotifier(async (move) => {
			moves.push({ from: move.from, to: move.to })
		})
		const { store, taskId } = await seedTask("backlog")

		// Created in a column rather than moved into one.
		expect(moves).toEqual([])

		await store.updateTask(taskId, { stage: "scoped" })
		// A move made by the pipeline rather than by hand is reported the same way.
		await store.linkTaskToHistory(taskId, "execution-1")
		// Neither renaming a card nor reordering it within its column is a move.
		await store.updateTask(taskId, { title: "Renamed" })
		await store.updateTask(taskId, { stage: "in_progress", position: 3 })

		expect(moves).toEqual([
			{ from: "backlog", to: "scoped" },
			{ from: "scoped", to: "in_progress" },
		])
	})

	it("hands the notifier the card as it stands after the move", async () => {
		const moves: BoardTaskMove[] = []
		BoardStore.setMoveNotifier(async (move) => {
			moves.push(move)
		})
		const { store, taskId } = await seedTask()

		await store.linkTaskToHistory(taskId, "execution-1")

		// The conversation the note belongs in is the one the move just linked.
		expect(moves[0]?.task).toMatchObject({ id: taskId, stage: "in_progress", linkedHistoryTaskId: "execution-1" })
	})

	it("keeps a card moved even when writing its note fails", async () => {
		BoardStore.setMoveNotifier(async () => {
			throw new Error("no conversation to write to")
		})
		const { store, taskId } = await seedTask()

		await expect(store.updateTask(taskId, { stage: "done" })).resolves.toBeDefined()
		expect(store.getSnapshot().tasks[0]).toMatchObject({ stage: "done" })
	})

	it("forgets a validation chat so the card can be validated again", async () => {
		const { store, taskId } = await seedTask()
		await store.linkValidationTask(taskId, "validate-1")

		await store.unlinkValidationTask(taskId)

		expect(store.getSnapshot().tasks[0]?.linkedValidationTaskId).toBeUndefined()
		// The card is validatable again.
		await expect(store.linkValidationTask(taskId, "validate-2")).resolves.toBeDefined()
	})

	it("leaves a retired card alone when its execution run reports completion again", async () => {
		const { store, taskId } = await seedTask()
		await store.linkTaskToHistory(taskId, "execution-1")
		await store.updateTask(taskId, { stage: "done" })

		await store.moveLinkedHistoryTaskToQaValidation("execution-1")

		expect(store.getSnapshot().tasks[0]).toMatchObject({ stage: "done" })
	})

	it("moves a card to qa validation when a validation task is linked", async () => {
		const { store, taskId } = await seedTask()
		await store.linkTaskToHistory(taskId, "execution-1")

		await store.linkValidationTask(taskId, "validate-1")

		expect(store.getSnapshot().tasks[0]).toMatchObject({
			stage: "qa_validation",
			linkedValidationTaskId: "validate-1",
			// Validation is a check, not a rerun, so the execution chat stays reachable.
			linkedHistoryTaskId: "execution-1",
		})
		await expect(store.linkValidationTask(taskId, "validate-2")).rejects.toThrow(/already linked/)
	})

	it("retires a card to done when its validation task completes", async () => {
		const { store, taskId } = await seedTask()
		await store.linkValidationTask(taskId, "validate-1")

		await store.moveLinkedValidationTaskToDone("validate-1")

		expect(store.getSnapshot().tasks[0]).toMatchObject({ stage: "done" })
	})

	it("does not retire a card whose validator sent it back before completing", async () => {
		const { store, taskId } = await seedTask()
		await store.linkValidationTask(taskId, "validate-1")
		// A failed validation writes its findings and returns the card for more work.
		await store.updateTask(taskId, { stage: "in_progress" })

		await store.moveLinkedValidationTaskToDone("validate-1")

		expect(store.getSnapshot().tasks[0]).toMatchObject({ stage: "in_progress" })
	})

	it("does not retire a card from an execution task completing", async () => {
		const { store, taskId } = await seedTask()
		await store.linkTaskToHistory(taskId, "execution-1")
		await store.moveLinkedHistoryTaskToQaValidation("execution-1")

		await store.moveLinkedValidationTaskToDone("execution-1")

		expect(store.getSnapshot().tasks[0]).toMatchObject({ stage: "qa_validation" })
	})

	it("persists the validation link across reopen", async () => {
		const directory = await mkdtemp(join(tmpdir(), "board-store-"))
		const store = new BoardStore(directory)
		await store.initialize()
		await store.createWorkspace("Planning")
		const workspaceId = store.getSnapshot().selectedWorkspaceId!
		await store.createTask({ workspaceId, title: "Implement" })
		await store.linkValidationTask(store.getSnapshot().tasks[0]!.id, "validate-1")

		const reopenedStore = new BoardStore(directory)
		await reopenedStore.initialize()

		expect(reopenedStore.getSnapshot().tasks[0]).toMatchObject({
			stage: "qa_validation",
			linkedValidationTaskId: "validate-1",
		})
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

	describe("activity log", () => {
		afterEach(() => BoardStore.setActivityContext(undefined))

		it("records a move forward as passed and a move back as blocked", async () => {
			const { store, taskId } = await seedTask("backlog")

			await store.updateTask(taskId, { stage: "scoped" })
			// The validator found unmet criteria and returned the card for more work.
			await store.updateTask(taskId, { stage: "qa_validation" })
			await store.updateTask(taskId, { stage: "in_progress" })

			expect(store.getSnapshot().activity).toMatchObject([
				{ from: "backlog", to: "scoped", outcome: "passed" },
				{ from: "scoped", to: "qa_validation", outcome: "passed" },
				{ from: "qa_validation", to: "in_progress", outcome: "blocked" },
			])
		})

		it("logs only moves, never a card created in a column or renamed in place", async () => {
			const { store, taskId } = await seedTask("backlog")

			await store.updateTask(taskId, { title: "Renamed" })
			await store.updateTask(taskId, { position: 3 })

			expect(store.getSnapshot().activity ?? []).toEqual([])
		})

		it("stamps an entry with the card reference and the mode of the column it left", async () => {
			const { store, taskId } = await seedTask("approved")
			const workspaceId = store.getSnapshot().selectedWorkspaceId!
			await store.setColumnMode(workspaceId, "approved", "code")
			BoardStore.setActivityContext(() => ({ mode: "ask", apiConfigName: "Anthropic prod" }))

			await store.linkTaskToHistory(taskId, "execution-1")

			expect(store.getSnapshot().activity?.[0]).toMatchObject({
				taskId,
				taskNumber: 1,
				taskTitle: "Implement",
				// The approved column's mode, not the host's currently selected one: that
				// column is what ran the work this move reports.
				mode: "code",
				apiConfigName: "Anthropic prod",
				from: "approved",
				to: "in_progress",
			})
		})

		it("falls back to the host's mode when the column it left has none", async () => {
			const { store, taskId } = await seedTask("approved")
			BoardStore.setActivityContext(() => ({ mode: "ask", apiConfigName: "OpenRouter cheap" }))

			await store.updateTask(taskId, { stage: "in_progress" })

			expect(store.getSnapshot().activity?.[0]).toMatchObject({ mode: "ask", apiConfigName: "OpenRouter cheap" })
		})

		it("records a move with no mode or API configuration when no host context is registered", async () => {
			const { store, taskId } = await seedTask("approved")

			await store.updateTask(taskId, { stage: "in_progress" })

			const entry = store.getSnapshot().activity?.[0]
			expect(entry).toMatchObject({ from: "approved", to: "in_progress" })
			expect(entry?.mode).toBeUndefined()
			expect(entry?.apiConfigName).toBeUndefined()
		})

		it("keeps the newest entries once the log is full", async () => {
			const { store, taskId } = await seedTask("approved")

			// Two moves per pass, so the log passes its cap partway through.
			for (let pass = 0; pass < BOARD_ACTIVITY_LIMIT; pass++) {
				await store.updateTask(taskId, { stage: "in_progress" })
				await store.updateTask(taskId, { stage: "approved" })
			}

			const activity = store.getSnapshot().activity ?? []
			expect(activity).toHaveLength(BOARD_ACTIVITY_LIMIT)
			// Oldest first, so the window that survives ends on the most recent move.
			expect(activity.at(-1)).toMatchObject({ from: "in_progress", to: "approved" })
		})

		it("drops the entries of a deleted workspace", async () => {
			const { store, taskId } = await seedTask("approved")
			const workspaceId = store.getSnapshot().selectedWorkspaceId!
			await store.updateTask(taskId, { stage: "in_progress" })

			await store.deleteWorkspace(workspaceId)

			expect(store.getSnapshot().activity).toEqual([])
		})

		it("survives a reopen, and reads a snapshot written before the log existed", async () => {
			const directory = await mkdtemp(join(tmpdir(), "board-store-"))
			const store = new BoardStore(directory)
			await store.initialize()
			await store.createWorkspace("Planning")
			const workspaceId = store.getSnapshot().selectedWorkspaceId!
			await store.createTask({ workspaceId, title: "Implement" })
			await store.updateTask(store.getSnapshot().tasks[0]!.id, { stage: "done" })

			// A board.json from before this feature has no `activity` key at all.
			const written = JSON.parse(await readFile(join(directory, "board.json"), "utf8"))
			const legacyStore = new BoardStore(directory)
			await legacyStore.initialize()
			expect(legacyStore.getSnapshot().activity).toHaveLength(1)

			delete written.activity
			await writeFile(join(directory, "board.json"), JSON.stringify(written), "utf8")
			const reopenedStore = new BoardStore(directory)
			await reopenedStore.initialize()

			expect(reopenedStore.getSnapshot().activity).toBeUndefined()
		})
	})

	describe("sharing one store across providers", () => {
		it("hands the same store to every consumer of a storage path", async () => {
			const directory = await mkdtemp(join(tmpdir(), "board-store-"))
			const other = await mkdtemp(join(tmpdir(), "board-store-"))

			expect(BoardStore.getInstance(directory)).toBe(BoardStore.getInstance(directory))
			expect(BoardStore.getInstance(directory)).not.toBe(BoardStore.getInstance(other))

			BoardStore.resetInstancesForTests()
		})

		/**
		 * The bug this sharing exists to prevent: the sidebar and a popped-out board
		 * window each built their own store over one board.json, and since a store
		 * reads that file once and then writes its whole in-memory copy back on every
		 * mutation, the second one served stale cards and reverted the first's edits.
		 */
		it("does not let a second consumer revert the first's edits", async () => {
			const directory = await mkdtemp(join(tmpdir(), "board-store-"))
			const sidebar = BoardStore.getInstance(directory)
			await sidebar.initialize()
			await sidebar.createWorkspace("Planning")
			const workspaceId = sidebar.getSnapshot().selectedWorkspaceId!
			await sidebar.createTask({ workspaceId, title: "Card", stage: "approved" })
			const cardId = sidebar.getSnapshot().tasks[0]!.id

			// Stands in for the board window: a second provider constructed later, which
			// used to mean a second store initialized from disk.
			const boardWindow = BoardStore.getInstance(directory)
			await boardWindow.initialize()

			await sidebar.updateTask(cardId, { stage: "in_progress" })
			// The window saving anything of its own must not roll that back.
			await boardWindow.updateTask(cardId, { title: "Card renamed" })

			expect(boardWindow.getSnapshot().tasks[0]).toMatchObject({
				stage: "in_progress",
				title: "Card renamed",
			})
			expect(JSON.parse(await readFile(join(directory, "board.json"), "utf8")).tasks[0]).toMatchObject({
				stage: "in_progress",
				title: "Card renamed",
			})

			BoardStore.resetInstancesForTests()
		})

		it("tells every subscriber about a mutation, whoever made it", async () => {
			const directory = await mkdtemp(join(tmpdir(), "board-store-"))
			const store = BoardStore.getInstance(directory)
			await store.initialize()

			// Two subscribers stand in for two providers' webviews.
			const sidebarSaw: string[] = []
			const windowSaw: string[] = []
			const unsubscribe = store.onDidChange((state) => {
				sidebarSaw.push(state.workspaces.map((workspace) => workspace.name).join(","))
			})
			store.onDidChange((state) => {
				windowSaw.push(state.workspaces.map((workspace) => workspace.name).join(","))
			})

			await store.createWorkspace("Planning")

			expect(sidebarSaw).toEqual(["Planning"])
			expect(windowSaw).toEqual(["Planning"])

			// A disposed provider stops being handed updates.
			unsubscribe()
			await store.createWorkspace("Second")

			expect(sidebarSaw).toEqual(["Planning"])
			expect(windowSaw).toEqual(["Planning", "Planning,Second"])

			BoardStore.resetInstancesForTests()
		})
	})
})
