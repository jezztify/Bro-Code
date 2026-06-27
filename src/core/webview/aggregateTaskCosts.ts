import type { HistoryItem, TokenUsage } from "@bro-code/types"

export interface AggregatedCosts {
	ownCost: number // This task's own API costs
	childrenCost: number // Sum of all direct children costs (recursive)
	totalCost: number // ownCost + childrenCost
	childBreakdown?: {
		// Optional detailed breakdown
		[childId: string]: AggregatedCosts
	}
	// Per-provider-profile token breakdown merged across this task and all its subtasks (recursive).
	profileBreakdown?: NonNullable<TokenUsage["profileBreakdown"]>
}

function mergeProfileBreakdowns(
	a: NonNullable<TokenUsage["profileBreakdown"]> | undefined,
	b: NonNullable<TokenUsage["profileBreakdown"]> | undefined,
): NonNullable<TokenUsage["profileBreakdown"]> | undefined {
	if (!a && !b) {
		return undefined
	}

	const merged: NonNullable<TokenUsage["profileBreakdown"]> = { ...a }

	for (const [profileName, usage] of Object.entries(b ?? {})) {
		const existing = merged[profileName]
		merged[profileName] = {
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
	// Prevent infinite loops
	if (visited.has(taskId)) {
		console.warn(`[aggregateTaskCostsRecursive] Circular reference detected: ${taskId}`)
		return { ownCost: 0, childrenCost: 0, totalCost: 0 }
	}
	visited.add(taskId)

	// Load this task's history
	const history = await getTaskHistory(taskId)
	if (!history) {
		console.warn(`[aggregateTaskCostsRecursive] Task ${taskId} not found`)
		return { ownCost: 0, childrenCost: 0, totalCost: 0 }
	}

	const ownCost = history.totalCost || 0
	let childrenCost = 0
	const childBreakdown: { [childId: string]: AggregatedCosts } = {}
	let profileBreakdown = history.profileBreakdown

	// Recursively aggregate child costs
	if (history.childIds && history.childIds.length > 0) {
		for (const childId of history.childIds) {
			const childAggregated = await aggregateTaskCostsRecursive(
				childId,
				getTaskHistory,
				new Set(visited), // Create new Set to allow sibling traversal
			)
			childrenCost += childAggregated.totalCost
			childBreakdown[childId] = childAggregated
			profileBreakdown = mergeProfileBreakdowns(profileBreakdown, childAggregated.profileBreakdown)
		}
	}

	const result: AggregatedCosts = {
		ownCost,
		childrenCost,
		profileBreakdown,
		totalCost: ownCost + childrenCost,
		childBreakdown,
	}

	return result
}
