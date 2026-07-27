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
