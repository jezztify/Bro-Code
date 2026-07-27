# Code Review: Recent Changes (the-bro-code)

**Date:** 2026-07-27 (rechecked)
**Scope:** 10 commits (`979f2a6404`..`63ccebe14a`) — fallback chains, configuration sets, tier routing, token breakdown, MCP fuzzy matching, LM Studio detection, context-overflow hardening, eval harness.

**Recheck note:** All findings below were re-verified directly against source (not re-derived from memory). One severity changed: **H4 → promoted to Critical** — confirmed the misclassification path calls `overwriteApiConversationHistory()`, i.e. it permanently discards real conversation content in response to an unrelated 400 error. Everything else held up as originally rated.

---

## Critical

### C1 (was H4) — Generic context-overflow detector triggers destructive, irreversible truncation on unrelated errors.

**Location:** [context-error-handling.ts:40-56](src/core/context/context-management/context-error-handling.ts#L40) → [Task.ts:3900-3924](src/core/task/Task.ts#L3900)

**Confirmed:** `checkIsGenericContextWindowError`'s `/\bmax(?:imum)?\s*(?:input\s*)?tokens?\b/i` matches Anthropic's 400 `"max_tokens: 8192 > 4096, which is the maximum allowed"` — a parameter-validation error, not overflow. This routes into `handleContextWindowExceededError`, which calls `manageContext(...)` and then, at [Task.ts:3922-3924](src/core/task/Task.ts#L3922):

```typescript
if (truncateResult.messages !== this.apiConversationHistory) {
	await this.overwriteApiConversationHistory(truncateResult.messages)
}
```

This **permanently overwrites the persisted conversation history** — real user/assistant turns are discarded — to fix a bug that has nothing to do with context size. The retry then fails with the identical 400, repeats up to `MAX_CONTEXT_WINDOW_RETRIES` times, each pass destroying more history, and still never succeeds.

Also affects Groq: `/\btoken\s*limit\b/i` matches its 429 rate-limit body, which steals the error from `isRetriableViaFallbackError` (context-window errors are excluded from failover), so a transient rate limit gets truncation instead of retry/failover.

**Minimal fix:** require an overflow verb alongside the token noun — e.g. `/\b(?:exceed|too\s+(?:many|long|large))\b.*\btokens?\b/i` — and explicitly exclude strings matching `max_tokens:\s*\d+\s*>` (a parameter-bound violation, not overflow).

---

## High

### H1 — `tierApiConfigs` never reaches the webview; Settings UI always shows unset.

**Location:** [ClineProvider.ts:2706](src/core/webview/ClineProvider.ts#L2706) `getState()`

**Confirmed:** `getState()`'s return object is built field-by-field (no `...stateValues` spread — checked), and `tierApiConfigs` isn't one of the fields. Write path ([webviewMessageHandler.ts:2027](src/core/webview/webviewMessageHandler.ts#L2027)) and runtime read ([ClineProvider.ts:1599](src/core/webview/ClineProvider.ts#L1599)) both work — this is purely the UI round-trip. After any `postStateToWebview()`, [SettingsView.tsx:134](webview-ui/src/components/settings/SettingsView.tsx#L134) sees `undefined` and all three tier dropdowns reset. `configurationSets` was wired correctly at [ClineProvider.ts:2803](src/core/webview/ClineProvider.ts#L2803) as a reference for the right pattern.

**Minimal fix:** one line — `tierApiConfigs: stateValues.tierApiConfigs ?? {},` in the `getState()` return.

---

### H2 — `maxFallbacksPerMode` has the same gap, but breaks runtime behavior, not just display.

**Location:** [ClineProvider.ts:2706](src/core/webview/ClineProvider.ts#L2706), consumed at [Task.ts:4374](src/core/task/Task.ts#L4374)

**Confirmed:** same omission as H1, but `state?.maxFallbacksPerMode ?? DEFAULT_MAX_FALLBACKS_PER_MODE` is read from the `getState()` result inside `tryFailoverToNextProfile`, so the cap is **always 5** regardless of what the user configures — this is a functional bug, not just a UI one.

**Minimal fix:** one line — `maxFallbacksPerMode: stateValues.maxFallbacksPerMode,` in the `getState()` return.

---

### H3 — Failover/tier routing mutate the global active profile; parent resumes on subtask's model after delegation.

**Location:** [ClineProvider.ts:1782-1810](src/core/webview/ClineProvider.ts#L1782) `activateProviderProfile`, used by both `tryFailoverToNextProfile` and `activateTierProfileIfConfigured`

**Confirmed:** `activateProviderProfile` writes `currentApiConfigName` via `contextProxy.setValue` — global, not task-scoped. Two consequences:

- Failover: a transient 429 permanently changes the user's globally-selected profile even after the task finishes.
- Tier routing (worse): `activateTierProfileIfConfigured` runs in `delegateParentAndOpenChild` before spawning a `tier: "trivial"` subtask. When the subtask finishes, the **parent resumes on the trivial-tier model**, silently — the opposite of what tier routing promises.

**Minimal fix:** snapshot the active profile name before switching, restore it when the task/subtask that triggered the switch completes.

---

### H5 — Eval harness README instructs users to create ungitignored credential files.

**Location:** [scripts/eval/README.md:17](scripts/eval/README.md#L17), [scripts/eval/.gitignore](scripts/eval/.gitignore)

**Confirmed:** README tells users to copy `models.example.json` → `models.json` with real API keys. `.gitignore` only lists `scorecard.json`; `git check-ignore scripts/eval/models.json` returns not-ignored.

**Minimal fix:** add `models*.json` + `!models.example.json` to `scripts/eval/.gitignore`.

---

## Medium

### M1 — Failover chain can re-offer the profile it just switched to.

[Task.ts:4347-4351](src/core/task/Task.ts#L4347) clears `attemptedFallbackApiConfigIds` on first successful chunk, so the next failure restarts the chain from `fallbackIds[0]` even if that's the now-active profile.
**Minimal fix:** skip the currently-active config id in the candidate loop.

### M2 — Fallback-chain editor is inert for built-in modes.

**Confirmed:** [ModesView.tsx:1028](webview-ui/src/components/modes/ModesView.tsx#L1028) calls `findModeBySlug(visualMode, customModes)`, which only searches the `customModes` array (checked definition at `src/shared/modes.ts:101`) — never matches a built-in mode slug, so `customMode` is `undefined` and `persistFallbacks` silently no-ops.
**Minimal fix:** hide the section (or show a disabled state with tooltip) when `!customMode`.

### M3 — `findClosestMatch` threshold allows real-word substitutions, not just typos.

[text-similarity.ts:41-68](src/utils/text-similarity.ts#L41): 3-char minimum, threshold floor of 2, means `get`→`set` (distance 1) matches. Opt-in experimental flag limits blast radius, but it silently invokes a different MCP tool with no approval gate.
**Minimal fix:** raise minimum length to 6, or require prefix match for names under ~6 chars.

### M4 — Manual "Retry" button bypasses `MAX_SAME_PROFILE_RETRIES`.

**Confirmed:** [Task.ts:4434-4436](src/core/task/Task.ts#L4434) — the non-auto-approval branch calls `tryFailoverToNextProfile` unconditionally on a retriable error, with no `retryAttempt` check. One manual click burns a fallback slot before same-profile retries are exhausted.
**Minimal fix:** gate this call behind the same `retryAttempt >= MAX_SAME_PROFILE_RETRIES` condition used in the auto-approval path.

### M5 — LM Studio fallback-detection buffer rescans from scratch on every chunk.

[lm-studio.ts:127-167](src/api/providers/lm-studio.ts#L127) calls `getBufferStatus(buffer)` (full rescan) per chunk; also withholds a legitimately-fenced code block from the UI until it closes.
**Minimal fix:** track scan offset incrementally; cap buffer size and force-flush past it.

### M6 — Same buffering can misfire on illustrative JSON inside prose.

Any chunk starting with `{` triggers buffering, including a model's own example of tool-call syntax while explaining it. Scoping to `offeredTools` doesn't prevent this since example syntax typically names a real offered tool.
**Minimal fix:** only attempt detection on the first text chunk of a message, not mid-message.

### M7 — `applyTierRecommendations` doesn't validate tier names from pasted JSON.

[webviewMessageHandler.ts:2028](src/core/webview/webviewMessageHandler.ts#L2028) writes any object key into `tierApiConfigs` unchecked.
**Minimal fix:** filter keys against the `DifficultyTier` union before merging.

### M8 — Zero changesets across 7 feature commits.

Three `fix(...)` commits added changesets; none of the seven `feat(...)` commits did.
**Minimal fix:** add `.changeset/` entries before merge (10 min each).

---

## Low

- **L1** — [runEval.ts](scripts/eval/runEval.ts#L115) recommends a model even when its average score is 0 (e.g., all calls 401'd). _Fix:_ skip zero-average tiers in the recommendation.
- **L2** — `isRetriableViaFallbackError`'s `/network/i`, `/timed? ?out/i` patterns are broad enough to false-positive on unrelated messages. _Fix:_ tighten to `/network\s+(?:error|failure)/i` etc.
- **L3** — Both classifiers parse `err.code` as a potential HTTP status; works today only because non-numeric codes parse to `NaN`. _Fix:_ restrict status parsing to `status`/`response.status` fields only.
- **L4** — Eval's Anthropic caller hardcodes `max_tokens: 1024`; OpenAI-compatible caller sends none — inconsistent, skews `freeform` scores. _Fix:_ make configurable per model/fixture.
- **L5** — Example model IDs (`claude-3-5-haiku-20241022`, `claude-sonnet-4-6`) will age quickly. _Fix:_ low priority, update opportunistically.
- **L6** — `no-explicit-any` suppression count bumped in production code (`context-error-handling.ts`, 2→5) rather than using `Record<string, unknown>` + narrowing. _Fix:_ optional cleanup.
- **L7** — `aggregateTaskCostsRecursive` clones `visited` per sibling, so a task reachable via two parents is double-counted in token/cost totals — now visible in the new breakdown modal. _Fix:_ pass `visited` by reference across siblings.
- **L8** — `WANTED_FEATURES.md`, `ZOO_vs_KILO.md`, `docs/` untracked at repo root. _Fix:_ commit or gitignore before shipping.

---

## Summary

| Severity | Count | Items                                                                      |
| -------- | ----- | -------------------------------------------------------------------------- |
| Critical | 1     | C1 — destructive truncation from misclassified errors                      |
| High     | 4     | H1, H2 (dead settings), H3 (wrong-model resume), H5 (credential leak risk) |
| Medium   | 8     | M1–M8                                                                      |
| Low      | 8     | L1–L8                                                                      |

## Fix order (minimal effort, highest impact first)

1. **C1** — tighten regex, exclude `max_tokens:\s*\d+\s*>` pattern (~15 min, stops data loss)
2. **H1 + H2** — two lines in `getState()` (~5 min, unblocks two shipped features)
3. **H5** — gitignore entry (~2 min)
4. **H3** — snapshot/restore active profile around task-scoped switches (~1-2 hrs)
5. **M4, M1** — same-profile-retry guard + skip-active-candidate check (~30 min combined)
6. **M8** — changesets (~10 min each)
7. Remaining M/L opportunistically.
