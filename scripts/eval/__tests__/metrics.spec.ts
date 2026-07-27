// cd src && node_modules/.bin/vitest run --config ../scripts/eval/vitest.config.ts

import { accuracy, setMetrics, cosineSimilarity } from "../metrics"

describe("accuracy", () => {
	it("scores 1 for an exact match (case/whitespace insensitive)", () => {
		expect(accuracy("Yes", "  yes  ")).toBe(1)
	})

	it("scores 0 for a mismatch", () => {
		expect(accuracy("yes", "no")).toBe(0)
	})
})

describe("setMetrics", () => {
	it("scores perfect precision/recall/f1 for an exact set match", () => {
		const result = setMetrics(["a.ts", "b.ts"], ["a.ts", "b.ts"])
		expect(result).toEqual({ precision: 1, recall: 1, f1: 1 })
	})

	it("computes partial precision/recall for a partial overlap", () => {
		// golden = {a, b, c}, predicted = {a, b, d}: intersection = {a, b} = 2
		const result = setMetrics(["a", "b", "d"], ["a", "b", "c"])
		expect(result.precision).toBeCloseTo(2 / 3)
		expect(result.recall).toBeCloseTo(2 / 3)
		expect(result.f1).toBeCloseTo(2 / 3)
	})

	it("returns all zeros when there is no overlap", () => {
		const result = setMetrics(["x"], ["y"])
		expect(result).toEqual({ precision: 0, recall: 0, f1: 0 })
	})

	it("returns all zeros when the model predicts an empty set", () => {
		const result = setMetrics([], ["a"])
		expect(result).toEqual({ precision: 0, recall: 0, f1: 0 })
	})

	it("is case/whitespace insensitive", () => {
		const result = setMetrics([" A.ts", "B.TS "], ["a.ts", "b.ts"])
		expect(result).toEqual({ precision: 1, recall: 1, f1: 1 })
	})
})

describe("cosineSimilarity", () => {
	it("scores 1 for identical vectors", () => {
		expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1)
	})

	it("scores 0 for orthogonal vectors", () => {
		expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
	})

	it("scores -1 for opposite vectors", () => {
		expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
	})

	it("returns 0 for mismatched lengths or empty vectors", () => {
		expect(cosineSimilarity([1, 2], [1])).toBe(0)
		expect(cosineSimilarity([], [])).toBe(0)
	})

	it("returns 0 for a zero vector", () => {
		expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
	})
})
