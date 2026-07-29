# QA revalidation — workspace-first Tasks board

**Result: BLOCKED**

## Acceptance criteria

- **QA-1 — PASS (focused):** Selected-workspace UI now posts `updateBoardWorkspace` for **Link folder**/**Change folder** and **Clear folder**; the store test creates, changes, clears, and reopens the optional link without VS Code workspace APIs. `pnpm --filter zoo-code exec vitest run core/board/__tests__/BoardStore.spec.ts` passed (3/3); the webview suite passed (4/4).
- **QA-2 — PASS (focused):** The same store suite confirms a selected logical workspace retains an empty-title Approved card and persisted snapshot; the webview suite covers blank-card rendering and Add-task wiring. No regression was found in the repaired scope.
- **QA-3 — PASS (focused):** `BoardPlanningSession` buffers tool calls until `approve()`, pins creates to its active workspace, rejects pre-approval, invalid-stage, and cross-workspace mutations, and contains no execution-task/history path. `pnpm --filter zoo-code exec vitest run core/board/__tests__/BoardPlanningSession.spec.ts` passed (1/1).
- **QA-4 — PASS (focused):** `ClineProvider.startBoardTask()` shares a per-card promise claim, rechecks the current link, releases the claim on success/failure, and links only after `createTask()` succeeds. The provider suite proves two concurrent starts invoke `createTask()` once, failed creation leaves the card unlinked, and completion moves only the matching linked card; `pnpm --filter zoo-code exec vitest run core/webview/__tests__/ClineProvider.taskHistory.spec.ts` passed (21/21).
- **QA-5 — PASS (focused):** `BoardStore.importHistoryOnce()` remains version-gated and imports only top-level history once; its focused regression remains green (3/3).

## Required regression evidence

- `pnpm --filter zoo-code exec vitest run core/board/__tests__/BoardStore.spec.ts` — passed: 1 file, 3 tests.
- `pnpm --filter zoo-code exec vitest run core/board/__tests__/BoardPlanningSession.spec.ts` — passed: 1 file, 1 test.
- `pnpm --filter zoo-code exec vitest run core/webview/__tests__/ClineProvider.taskHistory.spec.ts` — passed: 1 file, 21 tests.
- `pnpm --filter @roo-code/vscode-webview exec vitest run src/components/board/__tests__/TaskBoardView.spec.tsx` — passed: 1 file, 4 tests.
- `pnpm --filter @roo-code/types check-types && pnpm --filter zoo-code check-types && pnpm --filter @roo-code/vscode-webview check-types` — passed.
- All commands used Node 24.18.0 while the workspace requests Node 22.23.1. This emitted engine warnings only. The provider suite additionally emitted existing invalid file-URL Vite warnings and passed.

## Skipped checks and environment limits

- The QA-plan-required desktop extension-host smoke walkthrough and the planning-specific smoke were not executable in this non-interactive environment; neither has prior recorded evidence. They must verify folder lifecycle without changing the open VS Code folder, blank-card reload/focus, approval before planning mutation with no history entry, and linked-card completion.
- Workflow state currently reports `current_phase: implement`, not `qa_validate`; no workflow state was edited during this validation.

## Next action

**ENVIRONMENT_BLOCKER:** In an interactive VS Code extension-host session, run and record the two required QA-plan smoke walkthroughs; after the orchestrator advances the implemented rework to `qa_validate`, rerun this gate using that evidence.
