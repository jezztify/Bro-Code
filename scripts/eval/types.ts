export type FixtureTaskType = "classification" | "selection" | "freeform"

export type DifficultyTier = "trivial" | "standard" | "hard"

/**
 * A single golden fixture: an input/prompt plus the expected output, scoped to
 * one of the metric families in Feature 3 (per-step eval harness).
 */
export interface Fixture {
	id: string
	tier: DifficultyTier
	taskType: FixtureTaskType
	systemPrompt: string
	userPrompt: string
	/** classification: the expected label string. selection: the golden set of items. freeform: reference text. */
	expected: string | string[]
	description?: string
}

/** A provider profile to evaluate, identified by a label (shown in the scorecard). */
export interface ModelUnderTest {
	label: string
	settings: Record<string, unknown>
}

export interface FixtureResult {
	fixtureId: string
	modelLabel: string
	tier: DifficultyTier
	taskType: FixtureTaskType
	score: number
	raw: string
	error?: string
}

export interface ScorecardRow {
	modelLabel: string
	tier: DifficultyTier
	averageScore: number
	fixtureCount: number
}

export interface Scorecard {
	results: FixtureResult[]
	rows: ScorecardRow[]
	/** Recommended model label per tier, derived from the highest average score. */
	recommendation: Partial<Record<DifficultyTier, string>>
}
