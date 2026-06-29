// npx vitest run --config scripts/eval/vitest.config.ts

import { runEval } from "../runEval"
import type { Fixture, ModelUnderTest } from "../types"

const classificationFixture: Fixture = {
	id: "fx-classification",
	tier: "trivial",
	taskType: "classification",
	systemPrompt: "classify",
	userPrompt: "is this a fix?",
	expected: "yes",
}

const selectionFixture: Fixture = {
	id: "fx-selection",
	tier: "standard",
	taskType: "selection",
	systemPrompt: "select files",
	userPrompt: "which files?",
	expected: ["a.ts", "b.ts"],
}

const freeformFixture: Fixture = {
	id: "fx-freeform",
	tier: "hard",
	taskType: "freeform",
	systemPrompt: "summarize",
	userPrompt: "explain the trade-off",
	expected: "reference answer",
}

describe("runEval", () => {
	it("scores a classification fixture via accuracy", async () => {
		const models: ModelUnderTest[] = [{ label: "model-a", settings: {} }]
		const callModel = vi.fn().mockResolvedValue("Yes")

		const scorecard = await runEval([classificationFixture], models, callModel)

		expect(scorecard.results).toEqual([
			expect.objectContaining({ fixtureId: "fx-classification", modelLabel: "model-a", score: 1 }),
		])
		expect(scorecard.rows).toEqual([{ modelLabel: "model-a", tier: "trivial", averageScore: 1, fixtureCount: 1 }])
		expect(scorecard.recommendation).toEqual({ trivial: "model-a" })
	})

	it("scores a selection fixture via F1 against the golden set", async () => {
		const models: ModelUnderTest[] = [{ label: "model-a", settings: {} }]
		const callModel = vi.fn().mockResolvedValue('["a.ts", "c.ts"]')

		const scorecard = await runEval([selectionFixture], models, callModel)

		// golden={a,b}, predicted={a,c}: precision=1/2, recall=1/2, f1=1/2
		expect(scorecard.results[0].score).toBeCloseTo(0.5)
	})

	it("scores a freeform fixture via embedding cosine similarity", async () => {
		const models: ModelUnderTest[] = [{ label: "model-a", settings: {} }]
		const callModel = vi.fn().mockResolvedValue("the model's answer")
		const embed = vi.fn().mockResolvedValue([
			[1, 0],
			[1, 0],
		])

		const scorecard = await runEval([freeformFixture], models, callModel, embed)

		expect(embed).toHaveBeenCalledWith(["the model's answer", "reference answer"])
		expect(scorecard.results[0].score).toBeCloseTo(1)
	})

	it("throws a clear error per-fixture when a freeform fixture has no embedder, without crashing the run", async () => {
		const models: ModelUnderTest[] = [{ label: "model-a", settings: {} }]
		const callModel = vi.fn().mockResolvedValue("the model's answer")

		const scorecard = await runEval([freeformFixture], models, callModel)

		expect(scorecard.results[0].error).toMatch(/needs an embedder/)
		expect(scorecard.results[0].score).toBe(0)
	})

	it("records a per-fixture error instead of throwing when a model call fails", async () => {
		const models: ModelUnderTest[] = [{ label: "model-a", settings: {} }]
		const callModel = vi.fn().mockRejectedValue(new Error("network error"))

		const scorecard = await runEval([classificationFixture], models, callModel)

		expect(scorecard.results[0].error).toBe("network error")
		expect(scorecard.results[0].score).toBe(0)
	})

	it("builds a model x tier scorecard and recommends the highest-scoring model per tier", async () => {
		const models: ModelUnderTest[] = [
			{ label: "cheap", settings: {} },
			{ label: "strong", settings: {} },
		]

		const callModel = vi
			.fn()
			.mockImplementation(async (settings: Record<string, unknown>, _sys: string, _user: string) => {
				// Simulate: "strong" gets the trivial classification right, "cheap" doesn't.
				return settings.label === "strong" ? "yes" : "no"
			})

		// Inject the model label into settings so our fake callModel above can branch on it.
		const modelsWithLabel = models.map((m) => ({ ...m, settings: { ...m.settings, label: m.label } }))

		const scorecard = await runEval([classificationFixture], modelsWithLabel, callModel)

		const cheapRow = scorecard.rows.find((r) => r.modelLabel === "cheap")
		const strongRow = scorecard.rows.find((r) => r.modelLabel === "strong")
		expect(cheapRow?.averageScore).toBe(0)
		expect(strongRow?.averageScore).toBe(1)
		expect(scorecard.recommendation.trivial).toBe("strong")
	})
})
