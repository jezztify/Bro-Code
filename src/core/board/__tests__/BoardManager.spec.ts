import type { BoardActivityEntry, BoardState, BoardStage, BoardTask } from "@roo-code/types"
import { BOARD_MAX_REWORK_CYCLES, BOARD_QA_FINDINGS_HEADING } from "@roo-code/types"

import {
	BoardManager,
	boardReworkCycleCount,
	buildBoardResumeGuidance,
	selectBoardManagerAction,
} from "../BoardManager"
import type { BoardManagerHost } from "../BoardManager"

const WORKSPACE_ID = "workspace-1"

const card = (overrides: Partial<BoardTask> & { id: string; stage: BoardStage }): BoardTask => ({
	workspaceId: WORKSPACE_ID,
	title: `Card ${overrides.id}`,
	position: 0,
	createdAt: 0,
	updatedAt: 0,
	...overrides,
})

const boardState = (tasks: BoardTask[], overrides: Partial<BoardState> = {}): BoardState => ({
	version: 1,
	workspaces: [
		{
			id: WORKSPACE_ID,
			name: "Board",
			createdAt: 0,
			updatedAt: 0,
			manager: { enabled: true },
		},
	],
	tasks,
	migrations: {},
	...overrides,
})

const move = (overrides: Partial<BoardActivityEntry> & { from: BoardStage; to: BoardStage }): BoardActivityEntry => ({
	id: `activity-${overrides.from}-${overrides.to}`,
	workspaceId: WORKSPACE_ID,
	taskId: "card-1",
	taskTitle: "Card card-1",
	outcome: "blocked",
	at: 0,
	...overrides,
})

/** Nothing is running unless a test says so, and nothing has been written off. */
const idle = {
	isConversationWorking: () => false,
	isSkipped: () => false,
}

describe("selectBoardManagerAction", () => {
	it("refines the top backlog card when the board is otherwise empty", () => {
		const action = selectBoardManagerAction(
			boardState([
				card({ id: "second", stage: "backlog", position: 1 }),
				card({ id: "first", stage: "backlog", position: 0 }),
			]),
			WORKSPACE_ID,
			idle,
		)

		expect(action).toMatchObject({ kind: "refine", workingStage: "backlog" })
		expect(action?.task.id).toBe("first")
	})

	it("leaves scoped cards alone — approving them is the user's call", () => {
		const action = selectBoardManagerAction(
			boardState([card({ id: "card-1", stage: "scoped" })]),
			WORKSPACE_ID,
			idle,
		)

		expect(action).toBeUndefined()
	})

	it("leaves retired cards alone", () => {
		const action = selectBoardManagerAction(boardState([card({ id: "card-1", stage: "done" })]), WORKSPACE_ID, idle)

		expect(action).toBeUndefined()
	})

	it("starts an approved card before refining backlog, so work drains forward", () => {
		const action = selectBoardManagerAction(
			boardState([card({ id: "waiting", stage: "backlog" }), card({ id: "ready", stage: "approved" })]),
			WORKSPACE_ID,
			idle,
		)

		expect(action).toMatchObject({ kind: "start", workingStage: "in_progress" })
		expect(action?.task.id).toBe("ready")
	})

	it("will not start a second card while one is being implemented", () => {
		const action = selectBoardManagerAction(
			boardState([
				card({ id: "queued", stage: "approved" }),
				card({ id: "building", stage: "in_progress", linkedHistoryTaskId: "run-1" }),
			]),
			WORKSPACE_ID,
			{ ...idle, isConversationWorking: (id) => id === "run-1" },
		)

		expect(action).toBeUndefined()
	})

	it("will not start a second card while one is being validated", () => {
		const action = selectBoardManagerAction(
			boardState([
				card({ id: "queued", stage: "approved" }),
				card({ id: "checking", stage: "qa_validation", linkedValidationTaskId: "run-1" }),
			]),
			WORKSPACE_ID,
			{ ...idle, isConversationWorking: (id) => id === "run-1" },
		)

		expect(action).toBeUndefined()
	})

	it("waits for the validator that just sent a card back before resuming the work", () => {
		// The validator moves the card *then* signs off, so for a moment the card sits in
		// In Progress with its validator still writing. Resuming here would put a second
		// run in the same folder — and hand it a verdict that has not been written yet.
		const action = selectBoardManagerAction(
			boardState([
				card({
					id: "card-1",
					stage: "in_progress",
					linkedHistoryTaskId: "run-1",
					linkedValidationTaskId: "run-2",
				}),
			]),
			WORKSPACE_ID,
			{ ...idle, isConversationWorking: (id) => id === "run-2" },
		)

		expect(action).toBeUndefined()
	})

	it("will not refine the backlog while a card is in flight", () => {
		const action = selectBoardManagerAction(
			boardState([
				card({ id: "idea", stage: "backlog" }),
				card({ id: "building", stage: "in_progress", linkedHistoryTaskId: "run-1" }),
			]),
			WORKSPACE_ID,
			{ ...idle, isConversationWorking: (id) => id === "run-1" },
		)

		expect(action).toBeUndefined()
	})

	it("validates a card whose implementation has finished", () => {
		const action = selectBoardManagerAction(
			boardState([card({ id: "card-1", stage: "qa_validation", linkedHistoryTaskId: "run-1" })]),
			WORKSPACE_ID,
			idle,
		)

		expect(action).toMatchObject({ kind: "validate", workingStage: "qa_validation" })
	})

	it("takes the card closest to done first", () => {
		const action = selectBoardManagerAction(
			boardState([
				card({ id: "building", stage: "in_progress", linkedHistoryTaskId: "run-1" }),
				card({ id: "checking", stage: "qa_validation" }),
			]),
			WORKSPACE_ID,
			idle,
		)

		expect(action?.task.id).toBe("checking")
	})

	it("resumes a stopped implementation rather than leaving it parked", () => {
		const action = selectBoardManagerAction(
			boardState([card({ id: "card-1", stage: "in_progress", linkedHistoryTaskId: "run-1" })]),
			WORKSPACE_ID,
			idle,
		)

		expect(action).toMatchObject({ kind: "resume", workingStage: "in_progress" })
	})

	it("starts a card dragged into In Progress that has no run behind it", () => {
		const action = selectBoardManagerAction(
			boardState([card({ id: "card-1", stage: "in_progress" })]),
			WORKSPACE_ID,
			idle,
		)

		expect(action).toMatchObject({ kind: "start", workingStage: "in_progress" })
	})

	it("waits on a run that is asking the user something rather than interrupting it", () => {
		const action = selectBoardManagerAction(
			boardState([card({ id: "card-1", stage: "in_progress", linkedHistoryTaskId: "run-1" })]),
			WORKSPACE_ID,
			{ ...idle, isConversationWorking: () => true },
		)

		expect(action).toBeUndefined()
	})

	it("points a card sent back by validation at the run that blocked it", () => {
		const action = selectBoardManagerAction(
			boardState(
				[
					card({
						id: "card-1",
						stage: "in_progress",
						linkedHistoryTaskId: "run-1",
						linkedValidationTaskId: "validate-1",
					}),
				],
				{ activity: [move({ from: "qa_validation", to: "in_progress" })] },
			),
			WORKSPACE_ID,
			idle,
		)

		expect(action?.kind).toBe("resume")
		expect(action?.reason).toEqual({ kind: "fix", validationTaskId: "validate-1" })
	})

	it("does not accuse a freshly started card of having failed validation", () => {
		const action = selectBoardManagerAction(
			boardState([card({ id: "card-1", stage: "in_progress", linkedHistoryTaskId: "run-1" })], {
				activity: [move({ from: "approved", to: "in_progress", outcome: "passed" })],
			}),
			WORKSPACE_ID,
			idle,
		)

		expect(action?.reason).toEqual({ kind: "continue" })
	})

	it("treats a card dragged back out of validation by hand as blocked too", () => {
		// The board paints that move as BLOCKED whoever made it, and the run picking the
		// card up needs to know why it came back either way.
		const action = selectBoardManagerAction(
			boardState(
				[
					card({
						id: "card-1",
						stage: "in_progress",
						linkedHistoryTaskId: "run-1",
						linkedValidationTaskId: "validate-1",
					}),
				],
				{ activity: [move({ from: "qa_validation", to: "in_progress" })] },
			),
			WORKSPACE_ID,
			idle,
		)

		expect(action?.reason).toMatchObject({ kind: "fix" })
	})

	it("leaves a backlog card that already has a refinement chat to the user", () => {
		const action = selectBoardManagerAction(
			boardState([card({ id: "card-1", stage: "backlog", linkedRefinementTaskId: "chat-1" })]),
			WORKSPACE_ID,
			idle,
		)

		expect(action).toBeUndefined()
	})

	it("skips a card it has already written off", () => {
		const action = selectBoardManagerAction(
			boardState([
				card({ id: "stalled", stage: "approved", position: 0 }),
				card({ id: "healthy", stage: "approved", position: 1 }),
			]),
			WORKSPACE_ID,
			{ ...idle, isSkipped: (id) => id === "stalled" },
		)

		expect(action?.task.id).toBe("healthy")
	})

	it("skips a card with no title, which no action could run", () => {
		const action = selectBoardManagerAction(
			boardState([card({ id: "card-1", stage: "approved", title: "   " })]),
			WORKSPACE_ID,
			idle,
		)

		expect(action).toBeUndefined()
	})

	it("ignores cards belonging to another workspace", () => {
		const action = selectBoardManagerAction(
			boardState([card({ id: "card-1", stage: "approved", workspaceId: "somewhere-else" })]),
			WORKSPACE_ID,
			idle,
		)

		expect(action).toBeUndefined()
	})
})

describe("boardReworkCycleCount", () => {
	const cardOne = card({ id: "card-1", stage: "in_progress" })

	it("counts nothing for a card validation has never sent back", () => {
		const state = boardState([cardOne], { activity: [move({ from: "approved", to: "in_progress" })] })

		expect(boardReworkCycleCount(state, cardOne)).toBe(0)
	})

	it("counts each time validation returned the card", () => {
		const state = boardState([cardOne], {
			activity: [
				move({ from: "qa_validation", to: "in_progress" }),
				move({ from: "in_progress", to: "qa_validation", outcome: "passed" }),
				move({ from: "qa_validation", to: "in_progress" }),
			],
		})

		expect(boardReworkCycleCount(state, cardOne)).toBe(2)
	})

	it("starts over once the card has been stopped and reset to approved", () => {
		// Stopping a card discards its run and its findings, so what follows is a fresh
		// attempt rather than a continuation of the argument that preceded it.
		const state = boardState([cardOne], {
			activity: [
				move({ from: "qa_validation", to: "in_progress" }),
				move({ from: "in_progress", to: "approved" }),
				move({ from: "approved", to: "in_progress", outcome: "passed" }),
				move({ from: "in_progress", to: "qa_validation", outcome: "passed" }),
				move({ from: "qa_validation", to: "in_progress" }),
			],
		})

		expect(boardReworkCycleCount(state, cardOne)).toBe(1)
	})

	it("ignores what happened to other cards", () => {
		const state = boardState([cardOne], {
			activity: [move({ from: "qa_validation", to: "in_progress", taskId: "someone-else" })],
		})

		expect(boardReworkCycleCount(state, cardOne)).toBe(0)
	})
})

describe("buildBoardResumeGuidance", () => {
	it("hands a blocked run the validator's own verdict", () => {
		const guidance = buildBoardResumeGuidance(
			{ kind: "fix", validationTaskId: "validate-1" },
			"Criterion 2 is not met: the error path in parser.ts:88 is never reached.",
		)

		expect(guidance).toContain("Fix the found issues")
		expect(guidance).toContain("parser.ts:88")
	})

	it("sends a blocked run to the card when the verdict cannot be read back", () => {
		const guidance = buildBoardResumeGuidance({ kind: "fix" })

		expect(guidance).toContain("read_board_tasks")
		expect(guidance).toContain(BOARD_QA_FINDINGS_HEADING)
	})

	it("ignores a verdict that is only whitespace", () => {
		const guidance = buildBoardResumeGuidance({ kind: "fix", validationTaskId: "validate-1" }, "   \n  ")

		expect(guidance).toContain("read_board_tasks")
	})

	it("just says carry on when nothing blocked the card", () => {
		const guidance = buildBoardResumeGuidance({ kind: "continue" })

		expect(guidance).toContain("Continue this task")
		expect(guidance).not.toContain("QA validation")
	})
})

describe("BoardManager", () => {
	/** Lets the manager's own async pass finish before the assertions read it. */
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

	/**
	 * A board that reacts to the manager the way the real one does — an action links a
	 * conversation and moves its card into the column that action works in. Without
	 * that the manager would be tested against a board where nothing it did ever
	 * happened, which is precisely the state it reads as a stall.
	 */
	const fakeBoard = (tasks: BoardTask[]) => {
		const state = boardState(tasks)
		const live = new Set<string>()
		/** What each run signed off with, once it has. */
		const verdicts = new Map<string, string>()
		let runs = 0
		const find = (id: string) => state.tasks.find((task) => task.id === id)!
		const launch = (
			id: string,
			link: "linkedHistoryTaskId" | "linkedRefinementTaskId" | "linkedValidationTaskId",
		) => {
			const runId = `run-${++runs}`
			find(id)[link] = runId
			live.add(runId)
			return runId
		}
		const host: BoardManagerHost = {
			refineBoardTask: vi.fn(async (id: string) => void launch(id, "linkedRefinementTaskId")),
			startBoardTask: vi.fn(async (id: string) => {
				launch(id, "linkedHistoryTaskId")
				find(id).stage = "in_progress"
			}),
			validateBoardTask: vi.fn(async (id: string) => void launch(id, "linkedValidationTaskId")),
			resumeBoardTask: vi.fn(async (id: string) => void live.add(find(id).linkedHistoryTaskId!)),
			isConversationWorking: (id: string) => live.has(id),
			readCompletionMessage: async (id: string) => verdicts.get(id),
			log: () => {},
		}
		return {
			state,
			host,
			store: { getSnapshot: () => structuredClone(state) } as never,
			/** The run stops, and its card lands wherever the work left it. */
			finish: (runId: string, stage: BoardStage, verdict?: string) => {
				live.delete(runId)
				if (verdict) verdicts.set(runId, verdict)
				const task = state.tasks.find((candidate) =>
					[
						candidate.linkedHistoryTaskId,
						candidate.linkedRefinementTaskId,
						candidate.linkedValidationTaskId,
					].includes(runId),
				)
				if (task) task.stage = stage
			},
			/** The run stops without its card going anywhere. */
			abandon: (runId: string) => live.delete(runId),
		}
	}

	const managerFor = (board: ReturnType<typeof fakeBoard>, lock?: ReturnType<typeof fakeLock>) => {
		const manager = new BoardManager(board.store, lock as never)
		manager.setHost(board.host)
		return manager
	}

	/**
	 * Stands in for the claim that decides which window may drive a board. `granted`
	 * is what this host is told when it asks.
	 */
	const fakeLock = (granted: boolean) => ({
		claim: vi.fn(async () => granted),
		retain: vi.fn(async () => {}),
	})

	/** A card that has been round-tripped between validation and implementation `n` times. */
	const reworkedCard = (board: ReturnType<typeof fakeBoard>, cycles: number) => {
		board.state.activity = Array.from({ length: cycles }, () => move({ from: "qa_validation", to: "in_progress" }))
	}

	it("stops picking up a card validation keeps sending back", async () => {
		const board = fakeBoard([card({ id: "card-1", stage: "in_progress", linkedHistoryTaskId: "run-1" })])
		reworkedCard(board, BOARD_MAX_REWORK_CYCLES)

		managerFor(board).tick()
		await settle()

		// A ping-ponging card moves every time, so the ordinary stall check never sees
		// it. Left alone the two runs would trade it indefinitely.
		expect(board.host.resumeBoardTask).not.toHaveBeenCalled()
	})

	it("keeps working a card that still has rework budget left", async () => {
		const board = fakeBoard([card({ id: "card-1", stage: "in_progress", linkedHistoryTaskId: "run-1" })])
		reworkedCard(board, BOARD_MAX_REWORK_CYCLES - 1)

		managerFor(board).tick()
		await settle()

		expect(board.host.resumeBoardTask).toHaveBeenCalledWith("card-1", expect.any(String), expect.anything())
	})

	it("picks an exhausted card back up once the user moves it", async () => {
		const board = fakeBoard([card({ id: "card-1", stage: "in_progress", linkedHistoryTaskId: "run-1" })])
		reworkedCard(board, BOARD_MAX_REWORK_CYCLES)
		const manager = managerFor(board)

		manager.tick()
		await settle()

		// Dragged back to approved, which is the user saying to start over.
		board.state.tasks[0].stage = "approved"
		board.state.tasks[0].linkedHistoryTaskId = undefined
		manager.tick()
		await settle()

		expect(board.host.startBoardTask).toHaveBeenCalledWith("card-1", expect.anything())
	})

	it("leaves a board another window is already driving alone", async () => {
		// The other window has the card's execution run; this one's copy of the board may
		// not even show it yet, so acting here is what starts the same card twice.
		const board = fakeBoard([card({ id: "card-1", stage: "approved" })])

		managerFor(board, fakeLock(false)).tick()
		await settle()

		expect(board.host.startBoardTask).not.toHaveBeenCalled()
	})

	it("acts on a board it has claimed", async () => {
		const board = fakeBoard([card({ id: "card-1", stage: "approved" })])
		const lock = fakeLock(true)

		managerFor(board, lock).tick()
		await settle()

		expect(lock.claim).toHaveBeenCalledWith(WORKSPACE_ID)
		expect(board.host.startBoardTask).toHaveBeenCalledWith("card-1", expect.anything())
	})

	it("hands the board back as soon as the autopilot is switched off", async () => {
		const board = fakeBoard([card({ id: "card-1", stage: "approved" })])
		board.state.workspaces[0].manager = { enabled: false }
		const lock = fakeLock(true)

		managerFor(board, lock).tick()
		await settle()

		expect(lock.retain).toHaveBeenCalledWith(new Set())
	})

	it("gives up its claim when the last window closes", async () => {
		const board = fakeBoard([card({ id: "card-1", stage: "approved" })])
		const lock = fakeLock(true)
		const manager = managerFor(board, lock)

		manager.tick()
		await settle()
		await manager.standDown()

		expect(lock.retain).toHaveBeenLastCalledWith(new Set())
	})

	it("does nothing at all while it is switched off", async () => {
		const board = fakeBoard([card({ id: "card-1", stage: "approved" })])
		board.state.workspaces[0].manager = { enabled: false }

		managerFor(board).tick()
		await settle()

		expect(board.host.startBoardTask).not.toHaveBeenCalled()
	})

	it("does nothing before a host has been registered", async () => {
		const manager = new BoardManager(fakeBoard([card({ id: "card-1", stage: "approved" })]).store)

		expect(() => manager.tick()).not.toThrow()
		await settle()
	})

	it("runs a card's action under the manager's mode and profile", async () => {
		const board = fakeBoard([card({ id: "card-1", stage: "approved" })])
		board.state.workspaces[0].manager = { enabled: true, mode: "architect", apiConfigName: "Sonnet" }

		managerFor(board).tick()
		await settle()

		expect(board.host.startBoardTask).toHaveBeenCalledWith("card-1", {
			fallbackMode: "architect",
			apiConfigName: "Sonnet",
		})
	})

	it("acts once and then waits, rather than launching every card it can see", async () => {
		const board = fakeBoard([
			card({ id: "first", stage: "approved", position: 0 }),
			card({ id: "second", stage: "approved", position: 1 }),
		])
		const manager = managerFor(board)

		manager.tick()
		await settle()
		manager.tick()
		await settle()

		expect(board.host.startBoardTask).toHaveBeenCalledTimes(1)
		expect(board.host.startBoardTask).toHaveBeenCalledWith("first", expect.anything())
	})

	it("carries one card the whole way before picking up the next", async () => {
		const board = fakeBoard([
			card({ id: "first", stage: "approved", position: 0 }),
			card({ id: "second", stage: "approved", position: 1 }),
		])
		const manager = managerFor(board)

		manager.tick()
		await settle()
		// Implementation finishes, so the card is handed to validation.
		board.finish("run-1", "qa_validation")
		manager.tick()
		await settle()
		expect(board.host.validateBoardTask).toHaveBeenCalledWith("first", expect.anything())
		expect(board.host.startBoardTask).toHaveBeenCalledTimes(1)

		// Validation passes and retires it, which is what frees the board.
		board.finish("run-2", "done")
		manager.tick()
		await settle()

		expect(board.host.startBoardTask).toHaveBeenNthCalledWith(2, "second", expect.anything())
	})

	it("hands a card sent back by validation the verdict that sent it back", async () => {
		// The card's own description is deliberately unhelpful here: what the run gets
		// told must come from the validator's sign-off, not from anything on the card.
		const board = fakeBoard([card({ id: "card-1", stage: "qa_validation", description: "Build it" })])
		board.state.activity = [move({ from: "in_progress", to: "qa_validation", outcome: "passed" })]
		const manager = managerFor(board)

		manager.tick()
		await settle()
		// The validator finds unmet criteria, writes its verdict, and returns the card.
		board.state.activity.push(move({ from: "qa_validation", to: "in_progress" }))
		board.state.tasks[0].linkedHistoryTaskId = "run-earlier"
		board.finish("run-1", "in_progress", "Criterion 2 not met: the error path in parser.ts:88 is unreachable.")
		manager.tick()
		await settle()

		expect(board.host.resumeBoardTask).toHaveBeenCalledWith(
			"card-1",
			expect.stringContaining("parser.ts:88"),
			expect.anything(),
		)
	})

	it("does not read a verdict for a card that was merely stopped", async () => {
		const board = fakeBoard([card({ id: "card-1", stage: "approved" })])
		const readCompletionMessage = vi.fn(board.host.readCompletionMessage)
		board.host.readCompletionMessage = readCompletionMessage
		const manager = managerFor(board)

		manager.tick()
		await settle()
		// The run stops on its own with the card still in In Progress: nothing blocked it.
		board.abandon("run-1")
		board.state.tasks[0].linkedValidationTaskId = "validate-1"
		manager.tick()
		await settle()

		expect(readCompletionMessage).not.toHaveBeenCalled()
	})

	it("sets a card aside when its run ends without moving it, and does not retry it", async () => {
		const board = fakeBoard([card({ id: "card-1", stage: "approved" })])
		const manager = managerFor(board)

		manager.tick()
		await settle()
		// The run dies without the card ever leaving In Progress.
		board.abandon("run-1")
		manager.tick()
		await settle()
		manager.tick()
		await settle()

		expect(board.host.resumeBoardTask).not.toHaveBeenCalled()
		expect(board.host.startBoardTask).toHaveBeenCalledTimes(1)
	})

	it("keeps the limit spoken for by a card it has set aside", async () => {
		// A card left sitting in In Progress still occupies the board, whether or not
		// the manager has given up on it — nothing new may be pulled in behind it.
		const board = fakeBoard([
			card({ id: "stuck", stage: "approved", position: 0 }),
			card({ id: "queued", stage: "approved", position: 1 }),
		])
		const manager = managerFor(board)

		manager.tick()
		await settle()
		board.abandon("run-1")
		manager.tick()
		await settle()
		manager.tick()
		await settle()

		expect(board.host.startBoardTask).toHaveBeenCalledTimes(1)
		expect(board.host.startBoardTask).not.toHaveBeenCalledWith("queued", expect.anything())
	})

	it("sets a card aside when its action throws, and moves on to the next", async () => {
		const board = fakeBoard([
			card({ id: "broken", stage: "approved", position: 0 }),
			card({ id: "healthy", stage: "approved", position: 1 }),
		])
		const startBoardTask = vi.fn(board.host.startBoardTask).mockRejectedValueOnce(new Error("Mode gone"))
		board.host.startBoardTask = startBoardTask

		managerFor(board).tick()
		await settle()

		expect(startBoardTask).toHaveBeenNthCalledWith(1, "broken", expect.anything())
		expect(startBoardTask).toHaveBeenNthCalledWith(2, "healthy", expect.anything())
	})

	it("picks a set-aside card back up once the user has moved it", async () => {
		const board = fakeBoard([card({ id: "card-1", stage: "approved" })])
		const manager = managerFor(board)

		manager.tick()
		await settle()
		board.abandon("run-1")
		manager.tick()
		await settle()
		expect(board.host.startBoardTask).toHaveBeenCalledTimes(1)

		// The user drags it back to approved, which is them saying "try again".
		board.state.tasks[0].stage = "approved"
		board.state.tasks[0].linkedHistoryTaskId = undefined
		manager.tick()
		await settle()

		expect(board.host.startBoardTask).toHaveBeenCalledTimes(2)
	})

	it("forgets what it was waiting on when it is switched off", async () => {
		const board = fakeBoard([card({ id: "card-1", stage: "approved" })])
		const manager = managerFor(board)

		manager.tick()
		await settle()
		board.state.workspaces[0].manager = { enabled: false }
		manager.tick()
		await settle()
		board.state.workspaces[0].manager = { enabled: true }
		manager.tick()
		await settle()

		// Switched back on, the card is now in In Progress with a live run, so the
		// manager leaves it be rather than acting on it again.
		expect(board.host.startBoardTask).toHaveBeenCalledTimes(1)
		expect(board.host.resumeBoardTask).not.toHaveBeenCalled()
	})
})
