import { z } from "zod"

export const boardStageSchema = z.enum(["backlog", "scoped", "approved", "in_progress", "qa_validation", "done"])
export type BoardStage = z.infer<typeof boardStageSchema>

/** The stages in pipeline order, so a move can be read as progress or as a setback. */
export const BOARD_STAGE_ORDER = boardStageSchema.options

/**
 * Whether a move carried its card forward or sent it back. The QA validation column
 * is what this exists for — a validated card goes on to done, one with unmet criteria
 * is returned to in_progress — but it reads the same for every other column: a card
 * that advanced cleared its gate, a card that came back is held up.
 */
export const boardActivityOutcomeSchema = z.enum(["passed", "blocked"])
export type BoardActivityOutcome = z.infer<typeof boardActivityOutcomeSchema>

export const boardActivityOutcomeFor = (from: BoardStage, to: BoardStage): BoardActivityOutcome =>
	BOARD_STAGE_ORDER.indexOf(to) > BOARD_STAGE_ORDER.indexOf(from) ? "passed" : "blocked"

/**
 * Mode per board column, keyed by stage. A card is run in the mode of the column
 * it sits in, so the mode belongs to the workspace's columns rather than to
 * individual cards. A stage left unset means "whichever mode is selected when the
 * card starts". Spelled out key by key rather than as a record so an unset stage
 * stays valid — a `z.record` over the stage enum is exhaustive.
 */
export const boardColumnModesSchema = z
	.object({
		backlog: z.string().min(1),
		scoped: z.string().min(1),
		approved: z.string().min(1),
		in_progress: z.string().min(1),
		qa_validation: z.string().min(1),
		done: z.string().min(1),
	})
	.partial()
export type BoardColumnModes = z.infer<typeof boardColumnModesSchema>

export const boardWorkspaceSchema = z.object({
	id: z.string().min(1),
	name: z.string().trim().min(1),
	createdAt: z.number().finite(),
	updatedAt: z.number().finite(),
	linkedWorkspacePath: z.string().optional(),
	columnModes: boardColumnModesSchema.optional(),
})
export type BoardWorkspace = z.infer<typeof boardWorkspaceSchema>

export const boardTaskSchema = z.object({
	id: z.string().min(1),
	workspaceId: z.string().min(1),
	title: z.string(),
	description: z.string().optional(),
	/**
	 * The card's human-readable reference, rendered as `TASK-12`. Unique across the
	 * whole board rather than per workspace, so a number identifies exactly one card,
	 * and never reused once its card is deleted. Optional only so board snapshots
	 * written before numbering exists still parse; `BoardStore` backfills them on load.
	 */
	number: z.number().int().positive().optional(),
	stage: boardStageSchema,
	position: z.number().finite().nonnegative(),
	createdAt: z.number().finite(),
	updatedAt: z.number().finite(),
	linkedHistoryTaskId: z.string().min(1).optional(),
	linkedRefinementTaskId: z.string().min(1).optional(),
	/** The conversation that checked the finished implementation against the card's acceptance criteria. */
	linkedValidationTaskId: z.string().min(1).optional(),
})
export type BoardTask = z.infer<typeof boardTaskSchema>

export const BOARD_TASK_NUMBER_PREFIX = "TASK"

/** The card reference users and the model see, e.g. `TASK-12`. */
export const formatBoardTaskNumber = (number: number | undefined): string | undefined =>
	number === undefined ? undefined : `${BOARD_TASK_NUMBER_PREFIX}-${number}`

/**
 * Read a card reference back. Accepts what a person or model would plausibly
 * write — `TASK-12`, `task 12`, or a bare `12` — and nothing else, so an opaque
 * card ID is never mistaken for a number.
 */
export const parseBoardTaskNumber = (reference: string): number | undefined => {
	const match = /^(?:task[-_\s]?)?(\d+)$/i.exec(reference.trim())
	const number = match ? Number(match[1]) : NaN
	return Number.isInteger(number) && number > 0 ? number : undefined
}

/**
 * One line of the board's activity log: a card changing column, recorded with enough
 * context to read it without opening the card. A card can be renamed or deleted after
 * the fact, so the title and number are copied in rather than looked up — the log says
 * what the board looked like when it happened.
 */
export const boardActivityEntrySchema = z.object({
	id: z.string().min(1),
	workspaceId: z.string().min(1),
	taskId: z.string().min(1),
	taskNumber: z.number().int().positive().optional(),
	taskTitle: z.string(),
	from: boardStageSchema,
	to: boardStageSchema,
	outcome: boardActivityOutcomeSchema,
	/** The mode the card's column runs in, or the mode selected at the time. */
	mode: z.string().min(1).optional(),
	/** The name of the API configuration profile active when the move happened. */
	apiConfigName: z.string().min(1).optional(),
	at: z.number().finite(),
})
export type BoardActivityEntry = z.infer<typeof boardActivityEntrySchema>

/**
 * How many entries the log keeps. The board is stored as a single JSON file rewritten
 * on every mutation, so an unbounded log would make every card edit progressively more
 * expensive; the oldest entries fall off instead.
 */
export const BOARD_ACTIVITY_LIMIT = 200

export const boardStateSchema = z.object({
	version: z.literal(1),
	selectedWorkspaceId: z.string().min(1).optional(),
	/** Counter behind {@link boardTaskSchema.shape.number}; never decreases. */
	nextTaskNumber: z.number().int().positive().optional(),
	workspaces: z.array(boardWorkspaceSchema),
	tasks: z.array(boardTaskSchema),
	/** Oldest first, capped at {@link BOARD_ACTIVITY_LIMIT}. Absent in older snapshots. */
	activity: z.array(boardActivityEntrySchema).optional(),
	migrations: z.object({
		historyImport: z.literal(1).optional(),
	}),
})
export type BoardState = z.infer<typeof boardStateSchema>

export const boardPlanningSessionSchema = z.object({
	id: z.string().min(1),
	workspaceId: z.string().min(1),
	linkedWorkspacePath: z.string().optional(),
	approvalRequired: z.literal(true),
	approved: z.boolean(),
	assistantText: z.string(),
	status: z.enum(["planning", "awaiting_approval", "applying", "complete", "error"]),
	error: z.string().optional(),
})
export type BoardPlanningSessionState = z.infer<typeof boardPlanningSessionSchema>

export const createBoardWorkspaceInputSchema = z.object({
	name: z.string().trim().min(1),
	linkedWorkspacePath: z.string().optional(),
})
export const updateBoardWorkspaceInputSchema = createBoardWorkspaceInputSchema
	.partial()
	.refine(
		(value) => value.name !== undefined || value.linkedWorkspacePath !== undefined,
		"At least one workspace field is required",
	)
export const setBoardColumnModeInputSchema = z.object({
	workspaceId: z.string().min(1),
	stage: boardStageSchema,
	// null clears the column's mode, returning it to "use current mode".
	mode: z.string().min(1).nullable(),
})
export const createBoardTaskInputSchema = z.object({
	workspaceId: z.string().min(1),
	title: z.string().optional(),
	description: z.string().optional(),
	stage: boardStageSchema.optional(),
})
export const updateBoardTaskInputSchema = z
	.object({
		title: z.string().optional(),
		description: z.string().optional(),
		stage: boardStageSchema.optional(),
		position: z.number().finite().nonnegative().optional(),
	})
	.refine(
		(value) =>
			value.title !== undefined ||
			value.description !== undefined ||
			value.stage !== undefined ||
			value.position !== undefined,
		"At least one task field is required",
	)
