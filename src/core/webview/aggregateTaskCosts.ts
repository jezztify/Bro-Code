import type { HistoryItem, TokenUsage } from "@roo-code/types"

export interface AggregatedCosts {
	ownCost: number // This task's own API costs
	childrenCost: number // Sum of all direct children costs (recursive)
	totalCost: number // ownCost + childrenCost
	totalTokensIn: number // This task's own tokensIn + all subtasks' tokensIn (recursive)
	totalTokensOut: number // This task's own tokensOut + all subtasks' tokensOut (recursive)
	childBreakdown?: {
		// Optional detailed breakdown
		[childId: string]: AggregatedCosts
	}
	// Per-provider-profile token breakdown merged across this task and all its subtasks (recursive).
	profileBreakdown?: NonNullable<TokenUsage["profileBreakdown"]>
	// Per-model token breakdown merged across this task and all its subtasks (recursive).
	modelBreakdown?: NonNullable<TokenUsage["modelBreakdown"]>
}

function mergeBreakdowns(
	a: NonNullable<TokenUsage["profileBreakdown"]> | undefined,
	b: NonNullable<TokenUsage["profileBreakdown"]> | undefined,
): NonNullable<TokenUsage["profileBreakdown"]> | undefined {
	if (!a && !b) {
		return undefined
	}

	const merged: NonNullable<TokenUsage["profileBreakdown"]> = { ...a }

	for (const [key, usage] of Object.entries(b ?? {})) {
		const existing = merged[key]
		merged[key] = {
			tokensIn: (existing?.tokensIn ?? 0) + usage.tokensIn,
			tokensOut: (existing?.tokensOut ?? 0) + usage.tokensOut,
			cacheWrites:
				existing?.cacheWrites !== undefined || usage.cacheWrites !== undefined
					? (existing?.cacheWrites ?? 0) + (usage.cacheWrites ?? 0)
					: undefined,
			cacheReads:
				existing?.cacheReads !== undefined || usage.cacheReads !== undefined
					? (existing?.cacheReads ?? 0) + (usage.cacheReads ?? 0)
					: undefined,
			cost: (existing?.cost ?? 0) + usage.cost,
		}
	}

	return merged
}

/**
 * Recursively aggregate costs for a task and all its subtasks.
 *
 * @param taskId - The task ID to aggregate costs for
 * @param getTaskHistory - Function to load HistoryItem by task ID
 * @param visited - Set to prevent circular references
 * @returns Aggregated cost information
 */
export async function aggregateTaskCostsRecursive(
	taskId: string,
	getTaskHistory: (id: string) => Promise<HistoryItem | undefined>,
	visited: Set<string> = new Set(),
): Promise<AggregatedCosts> {
	// Prevent infinite loops, and prevent double-counting a task reachable via more than one
	// parent/sibling branch (visited is shared by reference across the whole traversal, not
	// cloned per branch - see the recursive call below).
	if (visited.has(taskId)) {
		console.warn(`[aggregateTaskCostsRecursive] Circular reference detected: ${taskId}`)
		return { ownCost: 0, childrenCost: 0, totalCost: 0, totalTokensIn: 0, totalTokensOut: 0 }
	}
	visited.add(taskId)

	// Load this task's history
	const history = await getTaskHistory(taskId)
	if (!history) {
		console.warn(`[aggregateTaskCostsRecursive] Task ${taskId} not found`)
		return { ownCost: 0, childrenCost: 0, totalCost: 0, totalTokensIn: 0, totalTokensOut: 0 }
	}

	const ownCost = history.totalCost || 0
	let totalTokensIn = history.tokensIn || 0
	let totalTokensOut = history.tokensOut || 0
	let childrenCost = 0
	const childBreakdown: { [childId: string]: AggregatedCosts } = {}
	let profileBreakdown = history.profileBreakdown
	let modelBreakdown = history.modelBreakdown

	// Recursively aggregate child costs
	if (history.childIds && history.childIds.length > 0) {
		for (const childId of history.childIds) {
			const childAggregated = await aggregateTaskCostsRecursive(
				childId,
				getTaskHistory,
				// Pass visited by reference (not a per-sibling clone): a task reachable via two
				// siblings/parents must only be counted once across the whole traversal, not once
				// per branch that reaches it.
				visited,
			)
			childrenCost += childAggregated.totalCost
			totalTokensIn += childAggregated.totalTokensIn
			totalTokensOut += childAggregated.totalTokensOut
			childBreakdown[childId] = childAggregated
			profileBreakdown = mergeBreakdowns(profileBreakdown, childAggregated.profileBreakdown)
			modelBreakdown = mergeBreakdowns(modelBreakdown, childAggregated.modelBreakdown)
		}
	}

	const result: AggregatedCosts = {
		ownCost,
		childrenCost,
		profileBreakdown,
		modelBreakdown,
		totalCost: ownCost + childrenCost,
		totalTokensIn,
		totalTokensOut,
		childBreakdown,
	}

	return result
}
