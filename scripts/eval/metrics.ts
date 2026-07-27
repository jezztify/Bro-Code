/**
 * Scoring functions for the three fixture task types:
 * - classification: accuracy = exact-match (normalized) / total
 * - selection: precision = |predicted ∩ golden| / |predicted|, recall = |predicted ∩ golden| / |golden|,
 *   f1 = 2·P·R / (P + R)
 * - freeform: embedding cosine similarity between the model's answer and a reference answer
 */

export function accuracy(predicted: string, expected: string): number {
	return normalize(predicted) === normalize(expected) ? 1 : 0
}

export interface SetMetrics {
	precision: number
	recall: number
	f1: number
}

export function setMetrics(predicted: string[], expected: string[]): SetMetrics {
	const golden = new Set(expected.map(normalize))
	const predictedSet = new Set(predicted.map(normalize))

	if (predictedSet.size === 0 || golden.size === 0) {
		return { precision: 0, recall: 0, f1: 0 }
	}

	let intersection = 0
	for (const item of predictedSet) {
		if (golden.has(item)) {
			intersection++
		}
	}

	const precision = intersection / predictedSet.size
	const recall = intersection / golden.size
	const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)

	return { precision, recall, f1 }
}

export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length || a.length === 0) {
		return 0
	}

	let dot = 0
	let normA = 0
	let normB = 0

	for (let i = 0; i < a.length; i++) {
		const ai = a[i] ?? 0
		const bi = b[i] ?? 0
		dot += ai * bi
		normA += ai * ai
		normB += bi * bi
	}

	if (normA === 0 || normB === 0) {
		return 0
	}

	return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function normalize(value: string): string {
	return value.trim().toLowerCase()
}
