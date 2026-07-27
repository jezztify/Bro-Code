import { accuracy, setMetrics, cosineSimilarity } from "./metrics"
import type { Fixture, FixtureResult, ModelUnderTest, Scorecard, ScorecardRow, DifficultyTier } from "./types"

export type ModelCaller = (
	settings: Record<string, unknown>,
	systemPrompt: string,
	userPrompt: string,
) => Promise<string>
export type Embedder = (texts: string[]) => Promise<number[][]>

/**
 * Tries to parse a model's freeform response as a JSON array of strings (for "selection"
 * fixtures). Falls back to splitting on commas/newlines so a plain-text list still scores.
 */
function parseSelection(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw)
		if (Array.isArray(parsed)) {
			return parsed.map(String)
		}
	} catch {
		// Not JSON; fall through to plain-text parsing.
	}

	return raw
		.split(/[\n,]/)
		.map((s) => s.trim())
		.filter(Boolean)
}

async function scoreFixture(fixture: Fixture, raw: string, embed: Embedder | undefined): Promise<number> {
	switch (fixture.taskType) {
		case "classification":
			return accuracy(raw, fixture.expected as string)
		case "selection":
			return setMetrics(parseSelection(raw), fixture.expected as string[]).f1
		case "freeform": {
			if (!embed) {
				throw new Error(
					`Fixture "${fixture.id}" needs an embedder for the similarity metric, but none was provided`,
				)
			}
			const embeddings = await embed([raw, fixture.expected as string])
			return cosineSimilarity(embeddings[0] ?? [], embeddings[1] ?? [])
		}
	}
}

/**
 * Scores every configured model against every fixture, and produces a model x tier
 * scorecard plus a recommended tier -> model-label mapping (highest average score
 * per tier). A per-fixture failure (model call or scoring error) is recorded as a
 * zero-score result with an `error` field rather than aborting the whole run.
 */
export async function runEval(
	fixtures: Fixture[],
	models: ModelUnderTest[],
	callModel: ModelCaller,
	embed?: Embedder,
): Promise<Scorecard> {
	const results: FixtureResult[] = []

	for (const model of models) {
		for (const fixture of fixtures) {
			try {
				const raw = await callModel(model.settings, fixture.systemPrompt, fixture.userPrompt)
				const score = await scoreFixture(fixture, raw, embed)
				results.push({
					fixtureId: fixture.id,
					modelLabel: model.label,
					tier: fixture.tier,
					taskType: fixture.taskType,
					score,
					raw,
				})
			} catch (error) {
				results.push({
					fixtureId: fixture.id,
					modelLabel: model.label,
					tier: fixture.tier,
					taskType: fixture.taskType,
					score: 0,
					raw: "",
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}
	}

	const rows = buildScorecardRows(results)
	const recommendation = recommendByTier(rows)

	return { results, rows, recommendation }
}

function buildScorecardRows(results: FixtureResult[]): ScorecardRow[] {
	const byKey = new Map<string, { modelLabel: string; tier: DifficultyTier; total: number; count: number }>()

	for (const result of results) {
		const key = `${result.modelLabel}::${result.tier}`
		const entry = byKey.get(key) ?? { modelLabel: result.modelLabel, tier: result.tier, total: 0, count: 0 }
		entry.total += result.score
		entry.count += 1
		byKey.set(key, entry)
	}

	return Array.from(byKey.values()).map((entry) => ({
		modelLabel: entry.modelLabel,
		tier: entry.tier,
		averageScore: entry.total / entry.count,
		fixtureCount: entry.count,
	}))
}

function recommendByTier(rows: ScorecardRow[]): Partial<Record<DifficultyTier, string>> {
	const best = new Map<DifficultyTier, ScorecardRow>()

	for (const row of rows) {
		const current = best.get(row.tier)
		if (!current || row.averageScore > current.averageScore) {
			best.set(row.tier, row)
		}
	}

	const recommendation: Partial<Record<DifficultyTier, string>> = {}
	for (const [tier, row] of best) {
		recommendation[tier] = row.modelLabel
	}
	return recommendation
}
