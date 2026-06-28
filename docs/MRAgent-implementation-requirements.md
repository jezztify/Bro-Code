# Implementation Requirements — MRAgent-Inspired Optimizations for Bro Code

Companion to [MRAgent-bro-code-integration.md](MRAgent-bro-code-integration.md) (architecture + diagrams) and [MRAgent-understanding.md](MRAgent-understanding.md) (paper summary).

This doc specifies _what to build_, in priority order. Three features:

1. **Durable structured memory** (file-based step hand-off) — highest leverage
2. **Per-step model router** — cheap win, plumbing exists
3. **Per-step eval harness** — feeds the router

Storage decision (already settled): step hand-off uses **files**, not a graph DB. A graph/knowledge layer (Kùzu/SQLite before Neo4j) is a separate, later feature for codebase-relationship retrieval, out of scope here.

---

## Feature 1 — Durable Structured Memory (file-based step hand-off)

### Goal

Give orchestration steps/subtasks a durable, human-editable, git-native place to read and write structured state — the analog of MRAgent's CSV data sheets — so long multi-step tasks stop depending on lossy `condense` summarization, and subtask→parent hand-off carries structured artifacts instead of a single text blob.

### Functional requirements

| #    | Requirement                                                                                                                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1.1 | State persists to files under a per-task directory, e.g. `.brocode/state/<rootTaskId>/`. JSON for structured records, MD for prose artifacts.                                                                                                 |
| F1.2 | A subtask can **write** an artifact keyed by name (e.g. `plan`, `api-contract`, `findings`) without overwriting unrelated keys.                                                                                                               |
| F1.3 | A step can **read** any prior artifact by key, returning current on-disk content (not a stale context copy).                                                                                                                                  |
| F1.4 | Artifacts are **human-editable** mid-run: if the user edits the file, the next read returns the edited content.                                                                                                                               |
| F1.5 | State directory participates in **git checkpoints** so it snapshots/restores with the code.                                                                                                                                                   |
| F1.6 | Parent task can enumerate artifacts produced by its children (replaces relying solely on the child's text completion message).                                                                                                                |
| F1.7 | Each workflow declares a **state schema/contract** (which keys exist, their shape) so steps agree on structure. Validate writes against it; surface validation errors as tool errors.                                                         |
| F1.8 | `read_state` and `write_state` are available to **every mode automatically** — all built-in modes (Code/Architect/Ask/Debug) and any custom mode — with **no per-mode group configuration required**. New modes inherit them with zero setup. |

#### Mode availability (F1.8) — how

Bro Code resolves a mode's tools in `getToolsForMode()` ([src/shared/modes.ts:28](../src/shared/modes.ts#L28)): it unions the tools from each group the mode declares, then unconditionally adds every entry in `ALWAYS_AVAILABLE_TOOLS` ([src/shared/tools.ts:317](../src/shared/tools.ts#L317)). Built-in and custom modes both flow through this same function.

**Therefore: add `read_state` and `write_state` to `ALWAYS_AVAILABLE_TOOLS`.** This is the single change that makes them universal — no edits to individual mode definitions, and every future/custom mode inherits them automatically. Do **not** put them in a tool _group_ (e.g. `read`/`edit`), since groups are opt-in per mode and would require each mode to enroll.

Design notes:

- `write_state` intentionally bypasses the `edit` group. The `edit` group gates edits to **user source files**; `write_state` only writes agent memory under `.brocode/state/`, so it should not be gated by a mode's source-edit permission. This is why it belongs in `ALWAYS_AVAILABLE_TOOLS`, not `edit`. (Path confinement per F1 technical requirements is what keeps this safe — it can _only_ touch the state dir.)
- Read-only modes (e.g. Ask) will gain `write_state`. This is intended: even a read-only mode may need to record orchestration state, and it still cannot touch source because it lacks the `edit` group.
- Add both names to the tool display-name map and any tool-name type unions alongside the existing `ALWAYS_AVAILABLE_TOOLS` entries, so prompts and validation recognize them.
- Consider auto-approval defaults: decide whether `write_state` (writes only under `.brocode/state/`) should be auto-approved like `update_todo_list`, or require approval like file writes. Recommended: auto-approve, since it cannot affect user source.

### Technical requirements / touch points

- **New tools**: `read_state` / `write_state` (or a single `manage_state` with an `action` param), under `src/core/tools/`. Follow the `BaseTool<...>` pattern (see `NewTaskTool.ts`). Register in `build-tools.ts` and tool schemas.
- **Universal mode availability** (F1.8): add both tool names to `ALWAYS_AVAILABLE_TOOLS` in `src/shared/tools.ts` (NOT to a `TOOL_GROUPS` entry). This makes them available to all built-in and custom modes via `getToolsForMode()` with no per-mode config. See the "Mode availability" subsection above for rationale.
- **Store module**: new `src/core/task-persistence/StateStore.ts` (sibling to `TaskHistoryStore.ts`) handling read/write/list/validate against the workspace `.brocode/state/<rootTaskId>/` path. Resolve `rootTaskId` from `Task.rootTaskId ?? taskId`.
- **Path safety**: confine all writes under the task state dir; reject `..`/absolute paths. Reuse existing ignore/protect logic (`src/core/ignore/`, `src/core/protect/`) so state files aren't accidentally treated as user source or fed back through indexing.
- **Checkpoints**: ensure `.brocode/state/` is included in checkpoint scope (`src/core/checkpoints/`). Confirm it is not excluded by `.gitignore`/`.brocodeignore` defaults — or deliberately decide whether state should be committed vs. checkpoint-only.
- **Subtask flow**: in `NewTaskTool` / `Task.ts` delegation, pass `rootTaskId` so children resolve the same state dir; optionally inject a system note listing available state keys at subtask start.
- **Schema**: store the per-workflow contract alongside state (e.g. `.brocode/state/<rootTaskId>/_schema.json`) or derive from a Custom Mode definition.

### UI requirements

- **State Inspector panel** in the webview (`webview-ui/`): list artifacts for the active task, show content, allow open-in-editor. Reuse the existing task-header info-button pattern (the v1.0.6 token-breakdown modal) as a precedent.
- Badge/indicator when state was edited by the user since the last agent read.

### Out of scope

- Cross-task / cross-project shared state (this is per-root-task only).
- Graph/relationship queries over state.

### Acceptance criteria

- A two-subtask orchestration where subtask A writes `api-contract` and subtask B reads it and acts on it, with **no** reliance on the parent forwarding the contract in text.
- Editing the artifact file by hand mid-run changes downstream behavior.
- Reverting a checkpoint restores both code and state together.

---

## Feature 2 — Per-Step Model Router

### Goal

Turn `modeApiConfigs` from a static per-mode binding into per-_step_ difficulty-tiered routing: cheap/local model for trivial steps (e.g. yes/no classification, formatting), strong model for steps needing judgment. MRAgent showed small models match large ones on binary tasks but collapse on nuanced ones — route accordingly.

### Functional requirements

| #    | Requirement                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| F2.1 | A workflow step / subtask can declare a **difficulty tier** (e.g. `trivial` / `standard` / `hard`).                                  |
| F2.2 | A user-configurable mapping **tier → provider profile** resolves which model runs each step.                                         |
| F2.3 | Falls back to the mode's existing `modeApiConfig`, then the global default, when no tier mapping exists (fully backward compatible). |
| F2.4 | Routing decisions are visible to the user (which model ran which step) and feed the existing per-profile token/cost breakdown.       |

### Technical requirements / touch points

- Extend state shape in `ClineProvider` near `modeApiConfigs` (`src/core/webview/ClineProvider.ts` ~L2680) with a `tierApiConfigs` map.
- Resolve the handler at step/subtask start in `Task.ts` using tier → profile → existing per-mode resolution chain.
- Surface in Settings → Providers UI; reuse profile-selection components already used for `modeApiConfigs`.
- Reuse the existing per-profile token/cost aggregation (v1.0.6 breakdown modal) — routing must not break recursive subtask cost attribution.

### Acceptance criteria

- A workflow with a `trivial` classification step and a `hard` synthesis step demonstrably hits two different providers, attributed correctly in the cost breakdown.
- With no tier config set, behavior is identical to today.

---

## Feature 3 — Per-Step Eval Harness

### Goal

Score each step's output per `mode × model` against golden references so the router's tier→model recommendations are data-driven, not guesswork. Directly answers the README's "model choice matters / try a stronger model" hand-wave — and differentiates a local-first tool.

### Functional requirements

| #    | Requirement                                                                                                                                                                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F3.1 | Define **fixtures**: input + golden expected output per step/task type.                                                                                                                                                                                   |
| F3.2 | Run a fixture against N configured models; compute a metric per the step type.                                                                                                                                                                            |
| F3.3 | Metrics per task type: **accuracy** (binary/classification), **precision/recall/F1** (set selection, e.g. file/symbol selection), **similarity** (free-form text vs. reference — embedding cosine, reuse the existing embedder used for Qdrant indexing). |
| F3.4 | Output a per-`mode × model` scorecard; derive a **recommended model per tier/mode**.                                                                                                                                                                      |
| F3.5 | Recommendations are exportable into Feature 2's tier→profile config.                                                                                                                                                                                      |

### Technical requirements / touch points

- New harness package/dir (e.g. `apps/` or a `packages/` workspace, or `scripts/eval/`). Keep it runnable headless (CI-friendly), not coupled to the webview.
- Reuse provider handlers from `src/api/providers/` to run the same models the product uses.
- Reuse the embedding provider abstraction used for codebase indexing for the similarity metric.
- Fixtures stored as files (JSON/MD), versioned in-repo.

### Acceptance criteria

- Running the harness over a fixture set produces a scorecard table (model × metric) and a recommended tier→model mapping.
- The recommendation can be applied to Feature 2 config in one step.

### Reference metrics (from the MRAgent paper)

- Accuracy = correct / total
- Precision = |A ∩ B| / |B|, Recall = |A ∩ B| / |A|, F1 = 2·P·R / (P + R) — where A = golden set, B = model set
- Similarity = embedding cosine between model output and reference

---

## Suggested build order

1. **Feature 1** (durable structured memory) — standalone, highest leverage, defensible.
2. **Feature 2** (model router) — small, plumbing largely exists.
3. **Feature 3** (eval harness) — enables Feature 2 to be data-driven; can land last.

Each is independently shippable. Features 2 and 3 are coupled (3 feeds 2) but 2 works with manual config before 3 exists.

## Non-goals (explicit)

- No graph database (Neo4j/Kùzu/etc.) — a knowledge-graph layer for codebase relationships or persistent cross-project memory is a separate future initiative.
- No hardcoded MRAgent-style fixed pipeline — the orchestrator stays a generic step graph.
- No cross-project / cross-session shared state in this scope.
