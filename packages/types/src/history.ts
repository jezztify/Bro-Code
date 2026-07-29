import { z } from "zod"

import { tokenUsageBreakdownEntrySchema } from "./message.js"
import { reasoningEffortOverrideSchema } from "./model.js"

/**
 * HistoryItem
 */

export const historyItemSchema = z.object({
	id: z.string(),
	rootTaskId: z.string().optional(),
	parentTaskId: z.string().optional(),
	number: z.number(),
	ts: z.number(),
	task: z.string(),
	tokensIn: z.number(),
	tokensOut: z.number(),
	cacheWrites: z.number().optional(),
	cacheReads: z.number().optional(),
	totalCost: z.number(),
	// This task's own per-provider-profile token breakdown (see TokenUsage.profileBreakdown).
	profileBreakdown: z.record(z.string(), tokenUsageBreakdownEntrySchema).optional(),
	// This task's own per-model token breakdown (see TokenUsage.modelBreakdown).
	modelBreakdown: z.record(z.string(), tokenUsageBreakdownEntrySchema).optional(),
	size: z.number().optional(),
	workspace: z.string().optional(),
	mode: z.string().optional(),
	apiConfigName: z.string().optional(), // Provider profile name for sticky profile feature
	/** Explicit per-task reasoning selection; omitted for Default/Auto. */
	reasoningEffort: reasoningEffortOverrideSchema.optional(),
	status: z.enum(["active", "completed", "delegated", "interrupted"]).optional(),
	delegatedToId: z.string().optional(), // Last child this parent delegated to
	childIds: z.array(z.string()).optional(), // All children spawned by this task
	awaitingChildId: z.string().optional(), // Child currently awaited (set when delegated)
	completedByChildId: z.string().optional(), // Child that completed and resumed this parent
	completionResultSummary: z.string().optional(), // Summary from completed child
})

export type HistoryItem = z.infer<typeof historyItemSchema>
