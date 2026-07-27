# Difficulty-tier eval harness

A standalone, opt-in Node/TS script that scores configured provider profiles per
`new_task` difficulty tier (`trivial` | `standard` | `hard`) against golden
fixtures, producing a model x tier scorecard and a recommended tier -> profile
mapping. It is **not** part of the VS Code extension build and does not run as
part of `pnpm lint` / `pnpm test` / `pnpm build` - it's invoked manually.

## Metrics

- **classification** fixtures: accuracy (normalized exact match)
- **selection** fixtures: file-selection precision / recall / F1 against a golden set
- **freeform** fixtures: embedding cosine similarity against a reference answer

## Usage

1. Copy `models.example.json` to a local file (e.g. `models.json`) and fill in real
   provider settings. **Do not commit real credentials** - `models.example.json`
   only contains placeholder values and any local copy should stay untracked.
2. Run:

    ```sh
    node_modules/.bin/tsx scripts/eval/runner.ts path/to/models.json
    ```

    Set `OPENAI_API_KEY` in the environment if any fixture is a `freeform` task
    (its similarity metric always calls an OpenAI-compatible embeddings endpoint,
    regardless of which provider answered the prompt).

3. The script prints a scorecard and a recommended tier -> profile-name mapping,
   and writes the full scorecard to `scripts/eval/scorecard.json` (gitignored).

## Applying results to Settings

Copy the printed `recommendation` object and paste it into the "Apply recommended
mapping" box under Settings -> Providers -> Difficulty Tier Routing. That sends an
`applyTierRecommendations` webview message which resolves each profile _name_ to
its profile _id_ and merges the result into `tierApiConfigs`, without needing to
match ids by hand.

## Fixtures

Fixtures live under `fixtures/*.json` (see `types.ts` for the `Fixture` shape).
One example per metric type is checked in; add more as needed - each file is
loaded independently, so there's no manifest to update.

## Tests

`scripts/eval` is intentionally not a pnpm workspace package (no `package.json`
of its own), so run its tests using a vitest binary resolvable from elsewhere in
the repo, e.g.:

```sh
cd src && node_modules/.bin/vitest run --config ../scripts/eval/vitest.config.ts
```
