// Usage: node_modules/.bin/tsx scripts/eval/runner.ts [path/to/models.json]
//
// models.json shape: [{ "label": "fast", "settings": { "apiProvider": "anthropic", "apiKey": "...", "apiModelId": "claude-3-5-haiku-20241022" } }, ...]
// See scripts/eval/models.example.json for the full shape (per-provider settings field names
// match packages/types/src/provider-settings.ts).
//
// An OPENAI_API_KEY is required for the "freeform" fixture's similarity metric, since that
// always uses an OpenAI-compatible embeddings endpoint regardless of which provider answered
// the prompt. Fixtures of other task types work without it.
import * as fs from "fs"
import * as path from "path"

import { runEval } from "./runEval"
import { callModel, type ModelSettings } from "./callModel"
import { createEmbeddings } from "./embed"
import type { Fixture, ModelUnderTest } from "./types"

const FIXTURES_DIR = path.join(__dirname, "fixtures")
const OUTPUT_PATH = path.join(__dirname, "scorecard.json")

function loadFixtures(): Fixture[] {
	return fs
		.readdirSync(FIXTURES_DIR)
		.filter((name) => name.endsWith(".json"))
		.map((name) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8")) as Fixture)
}

function loadModels(modelsConfigPath: string | undefined): ModelUnderTest[] {
	if (!modelsConfigPath) {
		throw new Error(
			"Usage: tsx scripts/eval/runner.ts path/to/models.json\n" +
				"See scripts/eval/models.example.json for the expected shape.",
		)
	}
	return JSON.parse(fs.readFileSync(modelsConfigPath, "utf8")) as ModelUnderTest[]
}

function printScorecard(scorecard: Awaited<ReturnType<typeof runEval>>) {
	console.log("\nScorecard (model x tier, average score):\n")
	for (const row of scorecard.rows) {
		console.log(
			`  ${row.modelLabel.padEnd(20)} ${row.tier.padEnd(10)} avg=${row.averageScore.toFixed(3)}  (n=${row.fixtureCount})`,
		)
	}

	const errors = scorecard.results.filter((r) => r.error)
	if (errors.length > 0) {
		console.log("\nErrors:")
		for (const r of errors) {
			console.log(`  [${r.modelLabel} / ${r.fixtureId}] ${r.error}`)
		}
	}

	console.log(
		"\nRecommended tier -> profile mapping. Paste this JSON into Settings -> Providers -> " +
			'"Apply recommended mapping" (sends an `applyTierRecommendations` message that resolves ' +
			"these profile NAMES to ids and merges them into tierApiConfigs):",
	)
	console.log(JSON.stringify(scorecard.recommendation, null, 2))
}

async function main() {
	const fixtures = loadFixtures()
	const models = loadModels(process.argv[2])

	const embedderApiKey = process.env.OPENAI_API_KEY
	const embed = embedderApiKey ? (texts: string[]) => createEmbeddings({ apiKey: embedderApiKey }, texts) : undefined

	const scorecard = await runEval(
		fixtures,
		models,
		(settings, systemPrompt, userPrompt) =>
			callModel(settings as unknown as ModelSettings, systemPrompt, userPrompt),
		embed,
	)

	fs.writeFileSync(OUTPUT_PATH, JSON.stringify(scorecard, null, 2))
	printScorecard(scorecard)
	console.log(`\nFull scorecard written to ${OUTPUT_PATH}`)
}

main().catch((error) => {
	console.error(error)
	process.exitCode = 1
})
