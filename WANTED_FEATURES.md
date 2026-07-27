# Wanted Features

Feature list of what the `bro-code` branch has already built on top of upstream `zoo/main`
(Zoo-Code-Org/Zoo-Code) — the `bro-code` branch is a clean rebase-able fork of Zoo Code (see
`REBASE_FROM_ZOO.md`), so this is a precise, commit-level diff rather than a guess.

---

# Bro Code features not in Zoo Code

This lists the functional (non-branding) differences between the `bro-code` branch and current
upstream `Zoo-Code-Org/Zoo-Code` (`main` @ `2db2af01f2`, "refactor(api): use canonical model cache
provider identifiers (#1020)"). The two branches share a fork point at `e2cdd3cb90` ("feat(ollama):
add native thinking/reasoning support (#832)").

Excluded from this list: rebranding (`Roo`/`Zoo` → `Bro`, `.roo/` → `.bro/`, icons, marketplace
publisher/name), version bumps, changelog/README churn, i18n string mirrors of the above, and two
changesets in the branch that are actually upstream Zoo Code fixes carried along for rebase
(`fix-litellm-model-desync`, `improve-apply-diff-prompt` — tagged `"zoo-code"` in their changeset
frontmatter, not `"bro-code"`).

## Durable task state (`.brocode/state/`)

- **`read_state` / `write_state` tools** — subtasks can hand off structured artifacts (plans, API
  contracts, findings) to each other via files under `.brocode/state/<rootTaskId>/`, available in
  every mode automatically with no per-mode configuration required.
- **Optional per-workflow state schema** — a `.brocode/state/<rootTaskId>/_schema.json`, when
  present, makes `write_state` validate the key/format against it instead of accepting anything.
- **State Inspector panel** — a task-header panel for viewing the state artifacts written by a task
  and its subtasks.
- **State travels with checkpoints** — `.brocode/state/` is included in checkpoint snapshot/restore,
  so durable state moves with code when a checkpoint is reverted or restored.

## Per-step / per-mode model routing

- **Named configuration sets** — under Settings → Modes, create multiple named sets (e.g. "Cheap",
  "Best Quality"), each holding its own full mode→provider mapping, and switch between them as one
  action instead of reassigning every mode's profile individually. Each VS Code workspace tracks its
  own active set and mode independently (switching in one window doesn't affect other open
  workspaces); only the underlying set/profile definitions are shared globally. Also changes prior
  behavior: saving/activating a provider profile no longer implicitly reassigns the active mode's
  provider mapping — assigning a profile to a mode is now an explicit action via a per-mode dropdown.
- **Per-mode API provider fallback** — a mode can fail over to an ordered list of backup provider
  profiles (`fallbackApiConfigIds`) when its primary provider keeps hitting transient errors (429/408,
  5xx, network failures). Fallbacks are tried once each after the primary's same-profile retries are
  exhausted; hard errors (401/403/400/422) never trigger fallback. Posts a chat notice on failover and
  switches the chatbox's displayed active provider for the rest of the task, without altering the
  mode's configured primary. Configurable per mode, including a cap on fallback count.
- **Per-step difficulty-tier model routing** — `new_task` accepts an optional difficulty tier
  (`trivial`/`standard`/`hard`); a Settings → Providers section maps each tier to a provider profile,
  falling back to the mode's own profile, then the global default.
- **Headless eval harness** (`scripts/eval/`) — scores configured provider profiles per difficulty
  tier against golden fixtures (classification accuracy, file-selection precision/recall/F1,
  freeform-answer embedding similarity), producing a model × tier scorecard and a recommended
  tier → profile mapping, applicable to the router config in one step from Settings.

## Settings / Providers correctness fixes

- Browsing provider profiles in Settings → Providers no longer activates them — selecting a
  different profile in the dropdown only loads it into the form for editing/preview; the mode's
  provider mapping, global state, and any running task's API handler are untouched until Save.
- Saving a provider's settings no longer reassigns the active mode's profile if you had browsed to a
  different (non-active) profile first — Save only reassigns the mode when saving the profile that's
  already active.
- `apiRequestTimeout` validation: values must be integers 1–3600s; invalid/out-of-range values
  (including `0`) now fall back to 600s, aligning with the SDK default.

## Subtask / orchestration fixes

- Subtasks created during mode delegation now load their own mode's configured provider profile
  instead of inheriting the parent task's.
- Fixed a delegated subtask never returning control to its parent if any other task (including the
  parent) was viewed in the history list while the subtask ran — this previously detached the
  subtask so its later `attempt_completion` had nowhere to resume.
- Fixed newly created subtasks briefly bouncing back to the homepage instead of showing their chat
  view before their first message streamed in.
- Fixed a task appearing stuck after a checkpoint was created with auto-approve disabled for
  Questions — `checkpointSave` now awaits posting the checkpoint message so it can't land after and
  visually bury a pending follow-up question.

## Context management

- Auto context condensing: results that still exceed the token budget (e.g. an oversized summary) are
  now caught and further truncated; recovery from a confirmed context-overflow API error always
  shrinks the conversation even if condensing itself fails; the truncate-and-retry safety net now
  recognizes context-overflow errors from providers beyond OpenAI/OpenRouter/Anthropic.

## Diff / editor UX

- Settings to control whether editor tabs opened during diff edits auto-close after accept/reject:
  auto-close transiently-opened files, auto-close even after user interaction, and auto-close newly
  created files.
- Diff view opens scrolled to the first changed line (end-of-file removals clamped to a valid line)
  instead of jumping to the top; post-accept/reject, previously-open files are restored to their
  pre-edit scroll position; transiently-opened files are closed unless the user interacted with that
  tab during the diff; pinned tabs stay pinned; preview-tab state is preserved; focus is no longer
  stolen back to the edited file if the user navigated elsewhere.

## Command auto-approval parsing

- Multi-line shell constructs that must be treated as one command are now parsed correctly for
  auto-approval: quoted multi-line arguments (`sh -c '...'`, `$'...'`, `"..."`), heredocs (all
  delimiter quoting styles, including unterminated ones), and locale quoting (`$"..."`). Quote masking
  is comment-aware. The command pattern breakdown UI uses the same parser so malformed/heredoc input
  no longer produces spurious allow/deny tokens.

## LM Studio provider

- Detects and executes tool calls that weaker LM Studio models emit as plain text/JSON/XML instead of
  real tool calls (bare JSON like `{"result": "..."}`, self-closing XML tags, XML tags with attributes,
  legacy Cline/Roo multi-child-tag format) via an ordered multi-pass fallback detector, scoped only to
  tools actually offered for the current request/mode (so illustrative example syntax in explain-only
  modes isn't mistaken for a real call).
- Native tool-call parameter errors now name the specific missing/unrecognized parameter(s) instead of
  a generic "missing nativeArgs" message, so weaker models can self-correct.
- Reasoning/thinking delivered as a structured `reasoning`/`reasoning_content` delta field (not just
  inline `<think>`/`<thought>` tags) now renders as a collapsible reasoning block, matching other
  OpenAI-compatible providers.

## LiteLLM

- Forwards the active task ID as an `X-Bro-Session-ID` request header (matching the `x-<vendor>-
session-id` convention used by Claude Code / GitHub Copilot) so conversations can be correlated in
  LiteLLM logs and spend tracking.

## Chat / task header UI

- Task header back-arrow behavior has changed twice: first added to return to task history (v1.0.5),
  later changed so it starts a new task instead ("Back to home"), with task history moved one click
  away via the History toolbar icon (v1.1.5).
- Token usage breakdown modal on the task header (added when a task's requests, including subtasks
  recursively, span more than one provider profile or model): breaks down tokens in/out and cost per
  profile, with a Model / Provider Profile toggle. The header's own token count now matches the modal's
  aggregated total for tasks with subtasks (previously the header showed only the current task's own
  tokens).
- Experimental "Fuzzy MCP tool name matching" toggle (Settings → Experimental, off by default) —
  resolves an MCP tool call naming a nonexistent-but-close tool name to the single unambiguous closest
  match, instead of erroring; only fires when exactly one candidate is close enough and unambiguous.
- Tasks opened from the history list no longer auto-continue immediately — they wait for explicit
  confirmation to resume.

## Docs

- README instructions for setting up Codebase Indexing against a self-hosted or cloud Qdrant
  instance.
- `docs/MRAgent-*.md` — design notes mapping the MRAgent (biology-inspired agent) architecture paper
  onto Bro Code's implementation, used to motivate/scope the durable-state and per-step-routing work
  above (informational/planning docs, not a shipped feature themselves).

## Implementation estimates (build-from-scratch, no reference implementation)

Assumes one senior engineer already familiar with this codebase's architecture (Task.ts ReAct loop,
provider abstraction, webview/extension-host split), designing and building each item as new work —
i.e. **not** cherry-picking the already-written code that exists on the `bro-code` branch. Estimates
are engineering time only (excludes PR review latency, staged rollout, telemetry burn-in). Ranges
reflect design-decision uncertainty (e.g. exact schema shape, exact UX) more than coding difficulty.

| #   | Feature group                                                                                                                                                                                               | Size | Estimate         | Notes / main risk                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Durable task state (`read_state`/`write_state`, schema validation, State Inspector panel, checkpoint integration)                                                                                           | XL   | 8–12 days        | New tool contracts on both native and XML tool-call paths, a small validation engine, a new webview panel, and checkpoint snapshot/restore plumbing. Riskiest part is getting the state/schema versioning right so it doesn't corrupt across checkpoint restores. |
| 2   | Named configuration sets (mode→provider set switching, per-workspace active set/mode, decoupling profile activation from mode assignment)                                                                   | L    | 6–9 days         | Touches core provider-settings state model and is a behavior change (activating a profile no longer reassigns a mode) — most of the time is UX/migration design and regression-proofing existing profile-switching flows, not the CRUD itself.                    |
| 3   | Per-mode API provider fallback chains                                                                                                                                                                       | L    | 5–7 days         | Retry/backoff sequencing across profiles, distinguishing soft (429/5xx/network) vs hard (401/403/400/422) errors, chat notification on failover, and a settings UI for ordering + capping the chain.                                                              |
| 4   | Per-step difficulty-tier model routing (`new_task` tier param → tier→profile map → mode → global fallback chain)                                                                                            | M    | 4–6 days         | Mostly plumbing a new optional param through `new_task` and a 3-level settings fallback; complexity is in the settings UI more than the routing logic.                                                                                                            |
| 5   | Headless eval harness (`scripts/eval/`: scorer, fixtures, metrics, model×tier scorecard)                                                                                                                    | L    | 5–8 days         | Separate from the extension proper — designing the fixture format and metrics (classification accuracy, file-selection P/R/F1, embedding similarity) is the bulk of the work; wiring "apply recommended mapping" back into Settings adds a day or two.            |
| 6   | Settings/Providers correctness fixes (browse ≠ activate, save doesn't clobber active mode, `apiRequestTimeout` validation)                                                                                  | S    | 1.5–3 days total | Three narrow, well-scoped bug fixes (~0.5–1 day each); low risk, mainly regression-test coverage for existing profile flows.                                                                                                                                      |
| 7   | Subtask/orchestration fixes (mode-scoped provider on delegation, detached-subtask-on-view-switch, subtask homepage flash, checkpoint/follow-up race)                                                        | M    | 3–5 days total   | Each is a targeted concurrency/state-ordering bug (~0.5–1.5 days); the detached-subtask and checkpoint-ordering fixes require the most careful async-sequencing work and test coverage.                                                                           |
| 8   | Context-condensing overflow hardening (catch oversized condense output, guarantee shrink on confirmed overflow, provider-agnostic overflow detection)                                                       | M    | 2–3 days         | Mostly extending existing condensing/retry paths; risk is regressing the "don't over-truncate on a false positive" balance.                                                                                                                                       |
| 9   | Diff-view scroll/tab UX (scroll-to-first-change, restore pre-edit scroll, transient-tab close rules, pinned/preview tab preservation, focus handling)                                                       | L    | 4–6 days         | Editor/tab-state tracking has many interacting edge cases (pinned vs preview vs transient, user-interacted-during-diff); most of the time is enumerating and testing those states, not any single piece of logic.                                                 |
| 10  | Command auto-approval parser rewrite (quote-aware newline splitting, heredocs incl. malformed, locale quoting, comment-aware masking, shared parser for the pattern-selector UI)                            | L    | 5–7 days         | A real mini shell-quoting parser — heredocs and comment-awareness are the parts most likely to have missed edge cases; needs a solid test matrix across quoting styles.                                                                                           |
| 11  | LM Studio tool-call fallback detection (multi-pass bare-JSON/XML-tag/attribute/legacy-format detector, request-scoped tool matching, specific missing-parameter errors, structured reasoning-field parsing) | L    | 4–6 days         | The ordered multi-pass detector plus scoping matches to only the tools offered this request is the trickiest part (avoiding false positives on illustrative example text).                                                                                        |
| 12  | LiteLLM `X-Bro-Session-ID` header                                                                                                                                                                           | XS   | 0.25–0.5 days    | One header, one call site.                                                                                                                                                                                                                                        |
| 13  | Task-header UI bundle (token usage breakdown modal w/ recursive subtask aggregation + model/profile toggle, fuzzy MCP tool-name matching, back-arrow behavior, no-auto-continue-on-open)                    | L    | 5–8 days         | The breakdown modal (recursive aggregation across subtask trees, per-model vs per-profile toggle) is the bulk of it (~3–4 days); fuzzy matching needs a similarity metric plus the "exactly one unambiguous candidate" guard (~1–2 days); the rest is small.      |
| 14  | Docs (Qdrant README section, MRAgent design docs)                                                                                                                                                           | XS   | 0.5–1 day        | Not really "implementation" — a README section is the only user-facing deliverable; the MRAgent docs are planning artifacts, not required to replicate the shipped features.                                                                                      |

**Total: roughly 55–85 engineer-days (≈ 11–17 weeks) for one engineer working sequentially.**
Items 1–5 (state + routing) are the largest chunk (~28–42 days) and are also the most
design-heavy — they're the best candidates to parallelize across engineers or to scope down first
if the timeline needs to shrink. Items 6–8 and 12 are cheap, low-risk, and can be picked up
opportunistically. Items 9–11 and 13 are UX/parsing-heavy and benefit most from a tight test matrix
written before implementation, since their risk is missed edge cases rather than raw complexity.
