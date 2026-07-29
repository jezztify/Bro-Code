# Implementation — workspace-first Tasks board

## Delivered

- Added the separate `BoardWorkspace` / `BoardTask` domain, Zod validation, and versioned `BoardState` snapshot contract.
- Added `BoardStore`, persisted atomically as `board.json` in extension global storage. It recovers from invalid snapshots, serializes mutations, supports workspace/card CRUD and selection, preserves empty titles, persists stage positions, imports top-level history once, and cascades only board cards when a logical workspace is deleted.
- Replaced the board’s host contracts with workspace/card mutation messages and `boardStateUpdated` state broadcasts.
- Added provider ownership of `BoardStore`, initial history import, state hydration, board state broadcasts, explicit card-to-execution-task linkage, and linked-card-only completion-to-Done updates.
- Reworked the desktop Tasks board to use selected logical board workspace data, create-workspace empty state, workspace selector/rename/delete controls, scoped search, every-column Add task, blank inline cards, manual stage moves, board-only deletion, and explicit Start/Open task affordances.
- Removed the production `HistoryItem.boardStage` data field, legacy `taskBoardStageChanged` wire contract, task-history stage persistence, and automatic history-derived completion stage writes.
- Added focused `BoardStore` unit coverage for blank-card persistence and idempotent top-level-only history import.

## Verification

- `pnpm --filter zoo-code exec vitest run core/board/__tests__/BoardStore.spec.ts`
  - Passed: 1 file, 2 tests.
  - Environment warning: current Node `v24.18.0`; workspace requests `22.23.1`.
- Editor diagnostics reported no errors in the modified board types, store, provider, handler, board UI, or extension-state context.

## Planning-session completion

- Added `BoardPlanningSession`, a standalone, transient model-stream controller. It does not construct `Task`, call `createTask()`/`newTask`, update `TaskHistoryStore`, or emit execution-history events.
- The provider creates the session only for the selected active `BoardWorkspace`. The system context contains its ID, name, and optional linked-folder path; the model receives only the two planning tool definitions.
- Added native `create_board_task` and `update_board_task` OpenAI-style definitions. `BoardPlanningSession` collects their streamed calls but rejects dispatch until `approve()` records explicit user approval. Creation is pinned to the selected workspace; updates reject missing, stale, cross-workspace, and invalid-stage cards before mutating `BoardStore`.
- Added ephemeral `boardPlanningUpdated` host messages and webview state. **Plan with AI** is enabled, starts the planning-only session, displays the proposed model text, and exposes **Approve plan and add cards** only once the stream has completed. Approval then applies the buffered board calls and broadcasts the resulting board snapshot.
- Removed the commented history-projection `TaskBoardView`, the skipped legacy board UI tests, obsolete task-history board-stage tests, and the obsolete `taskBoardStageChanged` handler test. Remaining board components were reformatted.

## Focused coverage and checks

- Added `src/core/board/__tests__/BoardPlanningSession.spec.ts`: validates workspace metadata, pre-approval rejection/no mutation, approved creation in the active workspace, invalid-stage rejection, and cross-workspace update rejection.
- Updated `webview-ui/src/components/board/__tests__/TaskBoardView.spec.tsx`: validates enabled planning start wiring, no `newTask` dispatch, approval control wiring, and blank-card behavior.
- Passed focused suites:
  - `pnpm --filter zoo-code exec vitest run core/board/__tests__/BoardStore.spec.ts core/board/__tests__/BoardPlanningSession.spec.ts core/webview/__tests__/ClineProvider.taskHistory.spec.ts` — 3 files, 21 tests.
  - `pnpm --filter @roo-code/vscode-webview exec vitest run src/components/board/__tests__/TaskBoardView.spec.tsx` — 1 file, 3 tests.
- Passed affected type checks:
  - `pnpm --filter @roo-code/types check-types`
  - `pnpm --filter zoo-code check-types`
  - `pnpm --filter @roo-code/vscode-webview check-types`
- All commands reported the existing Node-engine warning: workspace requires Node `22.23.1`; the environment used Node `24.18.0`.

## QA product-defect repairs

- Added the selected logical workspace folder-link lifecycle to `TaskBoardView`: the selected workspace now exposes **Link folder** or **Change folder** controls and a **Clear folder** control when linked. Each change posts the existing validated `updateBoardWorkspace` message only; these actions do not call VS Code workspace APIs or alter the editor workspace.
- Extended `BoardStore` coverage to persist an initial folder link, change it, clear it, and reopen the `board.json` snapshot with the cleared link retained.
- Made `ClineProvider.startBoardTask()` claim execution startup per board-card ID. The claim is shared by concurrent calls, waits for board initialization, re-reads the current card state, opens an existing linked execution task without creating another one, and always releases after completion or failure. A failed `createTask()` therefore leaves the board card unlinked and a later retry may start it normally.
- Preserved the planning-only boundary: folder-link changes are board metadata changes only; `BoardPlanningSession` remains separate from execution task creation.

### Focused regression evidence

- `pnpm --filter zoo-code exec vitest run core/board/__tests__/BoardStore.spec.ts core/webview/__tests__/ClineProvider.taskHistory.spec.ts`
  - Passed: 2 files, 24 tests.
  - Covers link/change/clear/reopen persistence, two concurrent board starts producing one execution task, failed creation retaining an unlinked card, and only the linked completed card moving to Done.
- `pnpm --filter @roo-code/vscode-webview exec vitest run src/components/board/__tests__/TaskBoardView.spec.tsx`
  - Passed: 1 file, 4 tests.
  - Covers Change folder and Clear folder UI message wiring.
- Both commands emitted the existing Node-engine warning: workspace requires Node `22.23.1`; the environment used Node `24.18.0`. The provider suite also emitted its existing invalid file-URL Vite warnings.
