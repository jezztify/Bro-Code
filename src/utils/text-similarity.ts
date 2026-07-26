/**
 * Generic string-similarity helpers used to recover from near-miss identifiers a model
 * produces instead of retrying with the exact name it was already given (tool names, MCP
 * tool names, parameter names, etc.).
 */

/**
 * Levenshtein edit distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
	const rows = a.length + 1
	const cols = b.length + 1
	const dist: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))

	for (let i = 0; i < rows; i++) dist[i][0] = i
	for (let j = 0; j < cols; j++) dist[0][j] = j

	for (let i = 1; i < rows; i++) {
		for (let j = 1; j < cols; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1
			dist[i][j] = Math.min(dist[i - 1][j] + 1, dist[i][j - 1] + 1, dist[i - 1][j - 1] + cost)
		}
	}

	return dist[rows - 1][cols - 1]
}

/**
 * Find the single unambiguous near-miss for a requested string among a set of candidates,
 * e.g. a truncated or slightly misspelled name that should have been an exact one.
 *
 * Deliberately conservative: only returns a match when exactly one candidate is close enough
 * (edit distance within 30% of the candidate's comparison key length, floor of 2) and no other
 * candidate ties or beats it, so callers never silently substitute the wrong thing.
 *
 * @param requested - The (already normalized/lowercased, as the caller wants to compare) string
 * @param candidates - The pool of valid items to match against
 * @param getKey - Extracts the comparable string from a candidate (also normalized/lowercased consistently with `requested`)
 * @returns The single closest candidate, or null if there's no confident, unambiguous match
 */
export function findClosestMatch<T>(requested: string, candidates: T[], getKey: (candidate: T) => string): T | null {
	if (requested.length < 3) {
		return null
	}

	let best: T | null = null
	let bestDistance = Infinity
	let bestIsTied = false

	for (const candidate of candidates) {
		const key = getKey(candidate)
		const distance = levenshteinDistance(requested, key)
		const threshold = Math.max(2, Math.floor(key.length * 0.3))

		if (distance > threshold) {
			continue
		}

		if (distance < bestDistance) {
			bestDistance = distance
			best = candidate
			bestIsTied = false
		} else if (distance === bestDistance) {
			bestIsTied = true
		}
	}

	return bestIsTied ? null : best
}
