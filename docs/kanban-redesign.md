# Kanban-First webview-ui Redesign

> **Superseded workflow model (2026-07-29):** The requirements below that derive board cards from `HistoryItem` records are replaced by the workspace-first workflow in this section. The persistent shell, visual stages, and separate per-task Kanban constraints remain valid unless explicitly contradicted here.

## Workspace-first planning workflow

The Task board is a planning surface, not a filtered view of chat history. The required flow is:

1. Create and select a **logical board workspace**.
2. Talk to an LLM in that workspace to explore and plan the work.
3. Let the LLM, after user approval, place planned cards on that workspace’s board.
4. Independently create blank cards and place or move them in any column before adding a title or starting implementation.

A board workspace is a user-created project grouping, separate from the currently open VS Code filesystem workspace. It may optionally link to a local folder for planning context, but it must never be implicitly created from, nor be limited to, that folder.

### New persistence model

Do **not** use `HistoryItem` as the board source of truth: it represents an execution conversation and cannot model an empty task that predates a conversation. Persist board data separately under extension global storage, using the same atomic and corruption-tolerant conventions as `TaskHistoryStore`.

```ts
export interface BoardWorkspace {
   id: string
   name: string
   createdAt: number
   updatedAt: number
   linkedWorkspacePath?: string
}

export type BoardStage = "backlog" | "scoped" | "approved" | "in_progress" | "done"

export interface BoardTask {
   id: string
   workspaceId: string
   title: string // "" is valid for an empty task
   description?: string
   stage: BoardStage
   position: number
   createdAt: number
   updatedAt: number
   linkedHistoryTaskId?: string
}
```

- A task belongs to exactly one board workspace and defaults to Backlog.
- Empty titles are valid; blank cards can be saved, moved, reloaded, and deleted.
- A board card does not create an execution task or conversation until the user explicitly selects **Start task**.
- Starting a titled card creates the normal execution task and stores its ID in `linkedHistoryTaskId`.
- Completing that linked execution task moves its card to Done. Other moves remain manual and unrelated execution history cannot alter cards.
- Deleting a card or board workspace must not delete existing execution history.

### Board UI

With no board workspace, show a **Create a workspace to start planning** empty state with a required name, an optional folder-link action, and a Create button. Do not auto-create a board workspace.

For a selected workspace, the board header must provide:

- a workspace selector and workspace actions (new, rename, optional folder link, delete);
- **Plan with AI**, which focuses/starts the planning chat with the active `boardWorkspaceId` as metadata;
- **New task**, which makes an empty Backlog card; and
- search and selection controls scoped to the selected board workspace.

Every column also has an accessible **Add task** action that immediately inserts and focuses an empty card in that column. Empty cards render an inline title field with the **Untitled task** placeholder; clicking them must edit the card, not send `showTaskWithId`.

### LLM planning

Planning chat is explicitly associated with the active board workspace. Its prompt instructs the LLM to clarify the goal, propose a plan, and only create board cards after approval. Add validated native tools:

```ts
create_board_task({ workspaceId, title?, description?, stage? })
update_board_task({ taskId, title?, description?, stage?, position? })
```

These tools create/update BoardTasks only; they must never create an execution `Task` or `HistoryItem`. Validate workspace/task/stage input at the extension-host boundary.

### Contracts, migration, and implementation slices

Add validated webview messages for board-workspace CRUD, board-task CRUD/moves, workspace selection, and `startBoardTask`, plus snapshot/incremental host broadcasts. The existing `taskBoardStageChanged` contract and `HistoryItem.boardStage` field are superseded and should be removed rather than retained alongside a second stage source.

Migrate existing history once: create one **Imported tasks** workspace only when history exists, import each top-level task as a linked BoardTask (completed → Done, otherwise Backlog), and record a migration version. Do not import child/delegated tasks as duplicate cards.

Implement in this order:

1. Types, atomic board store, and one-time migration.
2. Validated host messages, broadcasts, and LLM board-task tools.
3. Workspace-first board UI with empty-card creation/placement.
4. Planning-chat and explicit execution-task handoff/linking.
5. Regression coverage for the shell, Settings, Marketplace, chat dock, and standalone per-task Kanban.

### Acceptance criteria

- Users can create, select, rename, link, and delete logical board workspaces without changing the VS Code folder.
- Users can add completely empty cards directly into any stage, move them, reload, and find them unchanged.
- LLM planning creates approved board cards in the selected workspace without launching implementation conversations.
- A planned card can later create and link to an execution task; completion moves only that linked card to Done.

## Context

The extension's webview-ui currently opens on a full-screen Chat view, with History/Settings/Marketplace reached via native VS Code title-bar icons. The user wants the extension to become "Kanban-first" — landing on a logical-workspace task board instead of Chat — modeled on a reference design (a Framer mockup, "Harness") showing tasks as cards ("TASK-142") moving through manually-assigned stages: **Backlog → Scoped → Approved → In Progress → Done**.

This board is a *new* concept: it lists whole tasks/conversations (one card per task), distinct from the extension's existing per-task todo Kanban board (`webview-ui/src/components/kanban/KanbanBoardView.tsx`), which shows one active task's todo items in status columns (pending/in_progress/testing/completed) and must be left completely untouched.

## Shell architecture update

The reference-inspired persistent application shell is now adopted. [`webview-shell-redesign.md`](webview-shell-redesign.md) is the authoritative specification for shell layout and supersedes this document wherever the two conflict:

- The desktop webview uses a persistent, icon-only rail for Tasks, Settings, and Marketplace instead of relying exclusively on native VS Code title-bar navigation.
- A real single-task chat dock remains visible beneath the routed content pane. It reuses the existing chat implementation in docked mode and presents recent-task chips that use the existing `showTaskWithId` flow.
- The per-task Kanban board remains a standalone editor-tab panel and does not receive a rail entry or dock.

The shell layout requirements below remain in force. The preceding workspace-first section supersedes the older history-derived task model, persistence, message contract, flattened-card behavior, and deletion requirements.

Decisions locked in with the user across several rounds of clarification:
- New board replaces `HistoryView.tsx` entirely and becomes the new default landing tab (instead of Chat).
- Columns are **manually assigned per task** (not derived from execution status) — confirmed via live inspection of the reference site that this is the intended interaction, not just a status readout.
- Persistent desktop shell — use the reference-inspired icon-only rail for Tasks, Settings, and Marketplace. The rail intentionally omits mockup-only Agents/LLMs/multi-project entries; native toolbar commands continue to route to the same tabs.
- Persistent single-task chat dock — the dock is a real interaction surface, not static mockup content. It keeps the existing single-active-task model and uses the existing `showTaskWithId` flow for card clicks and recent-task chips.
- Mobile mode (`MobileApp.tsx`) is out of scope — untouched.
- All Settings sections/functionality remain fully intact and reachable exactly as before.

## Naming (avoids collision with the existing per-task Kanban board)

| Concept | Existing (untouched) | New |
|---|---|---|
| Data source | `kanbanBoard` (per-task `KanbanItem[]`, todo granularity) | `BoardWorkspace` and `BoardTask` stores (planning-task granularity) |
| Directory | `webview-ui/src/components/kanban/` | `webview-ui/src/components/board/` |
| Main component | `KanbanBoardView` | `TaskBoardView` |
| Card component | `KanbanCard` | `TaskBoardCard` |
| `Tab` type value | `"kanban"` | `"board"` (renamed from `"history"`) |
| i18n namespace | `chat:kanban.*` | `board:*` (new `board.json` per locale) |
| UI copy | "Board" | "Tasks" (avoid "Board" to prevent confusion with the untouched per-task Kanban board, which keeps saying "Board") |

## Data model: manual board stages

Add to `packages/types/src/history.ts`:
```ts
export const boardStageSchema = z.enum(["backlog", "scoped", "approved", "in_progress", "done"])
export type BoardStage = z.infer<typeof boardStageSchema>
```
Add `boardStage: boardStageSchema.optional()` to `historyItemSchema`, alongside the existing `status` field. `HistoryItem` is the right home for this — it's already the single persisted-per-task record (`src/core/task-persistence/TaskHistoryStore.ts`), already broadcast to the webview via `taskHistoryItemUpdated`, and already carries an analogous optional enum (`status`).

**Default on creation:** new tasks default to `boardStage: "backlog"`. Hook this into `TaskHistoryStore.upsertCore()` (TaskHistoryStore.ts:~214-216), which does a shallow merge of `{...existing, ...item}` — inject `boardStage: item.boardStage ?? existing?.boardStage ?? "backlog"` into that merge so it only defaults genuinely new items and never clobbers an assigned stage on routine resaves (`taskMetadata()` never sets `boardStage`, so it survives every message-save automatically).

**Auto-advance to "done" on completion:** when `HistoryItem.status` transitions to `"completed"`, also set `boardStage: "done"` in the same write. This is the one transition that's unambiguous; every other stage move stays fully manual. Two call sites set `status: "completed"` and both need this:
1. `src/core/webview/ClineProvider.ts` `onTaskCompleted` callback (~line 301-317) — normal completion.
2. `src/core/webview/ClineProvider.ts` `reopenParentFromDelegation`'s child updater inside its `atomicUpdatePair` call (~line 4199-4222) — delegation completion.

Because `status` can never leave `"completed"` (`VALID_TRANSITIONS.completed = []`), this fires exactly once per task and can't stomp a later manual change.

**Legacy items** (`boardStage === undefined`, created before this field existed): resolve at **read time in the webview**, not via backend migration — `boardStage ?? (status === "completed" ? "done" : "backlog")`. No backfill I/O; old completed tasks don't flood Backlog, old unfinished tasks surface as actionable. The first time a user moves such a card via the stage control, a real `boardStage` gets persisted.

**Message plumbing (new):**
- `packages/types/src/vscode-extension-host.ts`: add `"taskBoardStageChanged"` to `WebviewMessage.type`, import `BoardStage` as a type, and add a typed `boardStage?: BoardStage` field (reuse the existing `taskId` field for the target task).
- `src/core/webview/webviewMessageHandler.ts`: new awaited case near the existing `deleteTaskWithId` handler. Validate that `message.taskId` is a non-empty string and parse `message.boardStage` with `boardStageSchema.safeParse()` before calling `provider.updateTaskBoardStage(taskId, boardStage)`. Log and ignore malformed messages; webview messages are runtime data and TypeScript's optional field type alone is not validation.
- `src/core/webview/ClineProvider.ts`: new `updateTaskBoardStage()` method using `TaskHistoryStore.atomicReadAndUpdate()` (avoids read/write races), then broadcasts via the **existing** `taskHistoryItemUpdated` message — no new `ExtensionMessage` type needed, and `ExtensionStateContext.tsx`'s existing handler for that message already merges it into `taskHistory` state with zero changes required.
- Webview side: the stage-`Select` on each `TaskBoardCard` posts `{ type: "taskBoardStageChanged", taskId, boardStage }` on change.

## UI: move-stage control

Use the existing `Select`/`SelectTrigger`/`SelectContent`/`SelectItem` primitives (`webview-ui/src/components/ui/select.tsx`) on each card — the same primitives `HistoryView.tsx` already uses for its filter dropdowns. Stop propagation from the select trigger and its value-change interaction so changing a stage cannot also activate the card's `showTaskWithId` click handler. **No drag-and-drop for v1** (extra dependency and complexity the user didn't ask for; the reference site has no working interaction to clone anyway, it's a static mockup). Note it as a natural v2 — the backend/message contract here doesn't need to change for that later.

## Layout and ordering

The board must remain usable in the narrow VS Code sidebar as well as in editor-tab mode. Render five non-wrapping columns with a practical minimum column width and horizontal scrolling in the board content area; do not collapse columns into a vertical list. In the wider editor-tab context, the same grid fills the available width.

Within each stage, render newest-first by `ts`. `useTaskSearch` already produces newest-first results by default; the board consumes that order and must not expose or retain the History sort control/state. Refactor the hook only if needed to remove the now-unused sort API without changing its search, highlighting, or workspace-filter behavior for `HistoryPreview`.

## Column colors

Order: Backlog → Scoped → Approved → In Progress → Done, using the existing `bg-vscode-charts-*` swatch convention from `KanbanBoardView.tsx`:

| Column | swatch |
|---|---|
| Backlog | `bg-vscode-descriptionForeground` (neutral) |
| Scoped | `bg-vscode-charts-blue` |
| Approved | `bg-vscode-charts-purple` |
| In Progress | `bg-vscode-charts-yellow` |
| Done | `bg-vscode-charts-green` |

**Bonus fix needed:** `webview-ui/src/index.css`'s Tailwind v4 `@theme` block currently only registers `--color-vscode-charts-green/red/yellow` (index.css:~126-128) — `blue` and `purple` have no matching `@theme` token, so `bg-vscode-charts-purple`/`bg-vscode-charts-blue` won't actually render (Tailwind v4 needs a `--color-*` theme entry to emit the utility class). Add:
```css
--color-vscode-charts-blue: var(--vscode-charts-blue);
--color-vscode-charts-purple: var(--vscode-charts-purple);
```
This also happens to fix a pre-existing latent bug in the per-task Kanban board's "testing" column swatch (`bg-vscode-charts-purple`, `KanbanBoardView.tsx:27`), which is likely unstyled today for the same reason.

## Reuse plan (don't reinvent what already exists)

Reuse unchanged where possible:
- `webview-ui/src/components/history/useTaskSearch.ts` — search/workspace-filter state and the flat filtered `HistoryItem[]`. The board uses its documented newest-first order within each grouped column; remove unused sort API only if it can be done without affecting `HistoryPreview`.
- `TaskItemFooter.tsx`, `TaskStatusBadge.tsx`, `CopyButton.tsx`, `ExportButton.tsx`, `DeleteButton.tsx`, `DeleteTaskDialog.tsx`, `BatchDeleteTaskDialog.tsx` — imported into `TaskBoardCard.tsx` as-is.
- `webview-ui/src/components/common/Tab.tsx` (`Tab`/`TabHeader`/`TabContent`) for the page shell, matching every other full-page view.

Not reused directly — copy the relevant JSX into new components instead:
- `TaskItem.tsx` / `TaskGroupItem.tsx` — the board flattens (every task, parent or child, gets its own card with its own `boardStage`) rather than nesting subtasks under a collapsible parent, since that doesn't fit a column-card layout.

### Deletion behavior on flattened cards

Keep existing recursive deletion semantics. `TaskBoardView` must calculate descendant counts from complete `taskHistory` (not only the displayed search/workspace-filtered cards) and pass the count to `DeleteTaskDialog`, so deleting a parent card still warns about every child that will be removed. In batch selection, normalize selected IDs to root selections before posting `deleteMultipleTasksWithIds`: if a selected task has a selected ancestor, omit it from the dispatched IDs and from the confirmation count. This prevents duplicate delete requests while keeping each task independently visible and selectable on the board.

## New files

- `webview-ui/src/components/board/TaskBoardView.tsx` — main view: header (search + workspace filter, reused from `useTaskSearch`), 5-column grid, selection mode + batch delete (state relocated from `HistoryView.tsx`).
- `webview-ui/src/components/board/TaskBoardCard.tsx` — one task's card: truncated task text (with search-highlight), workspace row, `TaskItemFooter`, stage `Select`. Click (outside the select) posts `showTaskWithId` same as today's `TaskItem.tsx`.
- `webview-ui/src/components/board/TaskBoardColumn.tsx` — column header (label, count, swatch) + card list.
- `webview-ui/src/components/board/boardStage.ts` — `getEffectiveBoardStage()` helper + `COLUMNS` definition (label keys, order, swatch classes).
- `webview-ui/src/i18n/locales/<lang>/board.json` × 18 locales (English required now; others fall back to English via i18next until translated — matches how new namespaces are already handled, `webview-ui/src/i18n/setup.ts` globs `./locales/**/*.json`).
- `webview-ui/src/components/board/__tests__/TaskBoardView.spec.tsx`.

## Files to delete

- `webview-ui/src/components/history/HistoryView.tsx` + its spec file.
- Everything else in `webview-ui/src/components/history/` stays — `HistoryPreview.tsx` (the chat welcome screen's "recent tasks" widget) still imports several of these.

## `webview-ui/src/App.tsx` changes

- `type Tab = "settings" | "history" | "chat" | "marketplace" | "kanban"` → rename `"history"` to `"board"`.
- Default tab: `useState<Tab>("chat")` → `useState<Tab>("board")`.
- `tabsByMessageAction`: `historyButtonClicked: "history"` → `boardButtonClicked: "board"`.
- Render branch: `{tab === "history" && <HistoryView .../>}` → `{tab === "board" && <TaskBoardView onDone={() => switchTab("chat")} />}`.
- `kanban`/`settings`/`marketplace`/`ChatView` branches are untouched — confirms Settings wiring is unaffected.

Also add `"board"` to `WebviewMessage.tab` in `packages/types/src/vscode-extension-host.ts`. This is required because `HistoryPreview` posts `{ type: "switchTab", tab: "board" }`; otherwise its planned update will not type-check.

## Command rename: `historyButtonClicked` → `boardButtonClicked`

Full rename (not a silent repoint, to avoid a permanently misleading identifier), across:
- `packages/types/src/vscode.ts`, `packages/types/src/vscode-extension-host.ts` (including the `WebviewMessage.tab` union)
- `src/activate/registerCommands.ts` (handler body, telemetry label, log prefixes)
- `src/package.json` (toolbar command id + icon — pick something distinct from the per-task Kanban's `$(checklist)` icon and the old `$(history)` icon)
- `src/package.nls*.json` across all 18 locale files (mechanical key rename, keep old translated string as placeholder pending a follow-up localization pass)
- `webview-ui/src/components/history/HistoryPreview.tsx` — its "view all" link's `switchTab("history")` → `switchTab("board")`

## Tests to update/add

- `webview-ui/src/__tests__/App.spec.tsx`, `App.mobile.spec.tsx` — `Tab`/command-id renames, default-tab assertion (now board, not chat), swap `HistoryView` mock for `TaskBoardView`.
- `src/activate/__tests__/registerCommands.spec.ts`, `apps/vscode-e2e/src/suite/extension.test.ts` — command id rename.
- New `TaskBoardView.spec.tsx` — column grouping by `boardStage`, legacy-item fallback (both branches), stage-`Select` posts `taskBoardStageChanged`.
- Extend the board tests to verify that interacting with the stage select does not post `showTaskWithId`, and that stage-change messages use the expected `taskId` and valid stage value.
- Extend `src/core/task-persistence/__tests__/TaskHistoryStore.spec.ts` — new item defaults to `"backlog"`; update preserves existing stage when omitted; explicit stage honored.
- Extend `ClineProvider` task-history tests — completion sets `boardStage: "done"`; delegation-completion child gets `"done"`; `updateTaskBoardStage()` broadcasts correctly.
- Extend `webviewMessageHandler` tests — missing/invalid `taskId` or `boardStage` is rejected before persistence, while valid stage changes call `updateTaskBoardStage()`.
- Add deletion tests for a parent warning that includes its descendant count and for batch selection containing both a parent and child, which must dispatch only the parent ID.

## Verification pass: resolutions to gaps found before implementation

Two Explore passes checked every claim in this doc against the live codebase. Nearly everything matched exactly (including cited line numbers). The following six points needed resolving and should be treated as part of the spec:

1. **`useGroupedTasks` hook** (`webview-ui/src/components/history/useGroupedTasks.ts`) is used by `HistoryView.tsx` alongside `useTaskSearch` for grouping/collapse/expand/search-mode and subtask counting, but wasn't mentioned in the Reuse plan above. `TaskBoardView` must NOT import this hook — its grouping/collapse/search-mode responsibilities don't apply to the board's flattened design. Instead, write a small pure descendant-count helper (in `boardStage.ts` or inline in `TaskBoardView.tsx`) that walks the complete, unfiltered `taskHistory` by parent/child linkage, per the "Deletion behavior on flattened cards" section above.

2. **`DeleteButton.tsx`'s shift-click bypass** posts `deleteTaskWithId` directly, skipping the dialog and any count calculation — this is pre-existing `HistoryView` behavior, not something the board introduces. Leave `DeleteButton.tsx` untouched; the shortcut carries over unchanged since it's reused as-is. This is explicitly out of scope, not a gap in the new descendant-count warning logic.

3. **`onTaskCompleted` (`ClineProvider.ts:301-318`) writes `status: "completed"` through the `updateTaskHistory()` wrapper** (line 310 → wrapper's `taskHistoryStore.upsert()` at 2905, broadcast at 2912), not a direct store call — same for the `reopenParentFromDelegation` child updater (line 4204, inside `atomicUpdatePair`, lines 4199-4222). Add `boardStage: "done"` explicitly at both of these two call sites (into the object passed to `updateTaskHistory()` / the child updater's returned object) rather than centralizing the logic inside `updateTaskHistory()` itself, since that wrapper is also used for many non-completion status writes.

4. **Telemetry label**: `registerCommands.ts` calls `TelemetryService.instance.captureTitleButtonClicked("history")` (line 144). Per the "full rename, not a silent repoint" philosophy below, this string becomes `captureTitleButtonClicked("board")`.

5. **`package.json` has 3 occurrences of `historyButtonClicked`**, not just the command definition with the icon: the command def (line 79), a `view/title` menu placement (line 252), and an `editor/title` menu placement (line 284). All three need the rename.

6. **`webviewMessageHandler.ts` has no existing `message.taskId`-validated sibling case** to copy verbatim — `deleteTaskWithId`/`abandonSubtaskWithId` use unchecked `message.text!`. Implement the new `taskBoardStageChanged` case with real validation as specified above (non-empty-string `taskId` check + `boardStageSchema.safeParse(message.boardStage)`) — it's a stricter pattern than its siblings, not a copy of one.

## Verification

1. Build `packages/types`, the extension host (`src`), and `webview-ui`; fix any type errors from the schema/message additions.
2. Run unit tests for both the extension host and webview-ui workspaces.
3. Manual F5 dev-host walkthrough:
   - Fresh sidebar open lands on the new Tasks board (not Chat).
   - Send a new chat message → the resulting task appears in Backlog.
   - Let a task complete → it auto-jumps to Done.
   - Use the per-card stage control to move a card through Scoped → Approved → In Progress; reload the webview and restart the extension host to confirm the stage persisted to disk, not just memory.
   - An old pre-existing completed task appears in Done and an old active one appears in Backlog with no explicit migration step.
   - Scoped/Approved column swatches render actual blue/purple (catches the `@theme` token fix).
   - In the narrow sidebar, all five columns remain individually available through horizontal scrolling; in an editor tab, they use the available width.
   - Changing a card stage does not open the task; clicking non-control card content still opens the existing full-screen chat.
   - Deleting a parent warns about its descendants; selecting both a parent and child for batch deletion dispatches a single parent deletion.
   - The rail and native toolbar commands both navigate to Tasks, Settings, and Marketplace; the dock stays visible while switching panes; the per-task Kanban board (`$(checklist)`) still opens correctly and is visually unaffected.
   - Settings opens with all ~17 sections intact.
