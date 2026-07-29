# Persistent App Shell webview-ui Redesign

## Context

The prior redesign (`docs/kanban-redesign.md`) made the project-wide task board (`TaskBoardView`) the default landing tab, reached — like Settings and Marketplace — via native VS Code title-bar icons that each claim the full webview viewport one at a time. Chat itself stayed a full-screen view (`ChatView.tsx`), toggled in and out of view via an `isHidden` CSS class rather than mounted/unmounted, because it holds expensive, easily-lost state (streaming task, draft input, `askResponse` promises).

The user now wants the whole extension restructured into a persistent app shell, modeled on a reference design (a Framer mockup, "Harness") they showed directly: a left icon-rail, a main content area (the kanban board), and a persistent bottom chat dock with task chips, a message thread, and an input box. This went through two rounds of user clarification and two Explore research passes before being locked in, scoped down from the mockup in several ways described below.

This is a pure frontend/layout restructuring. No task-execution-model changes: the extension still runs exactly one active task at a time, unchanged from today.

## Locked decisions

1. **Shell scope.** The rail + content + dock shell wraps the whole extension — Chat, Settings, Marketplace, and the task Board all render inside it. The separate per-task todo Kanban board (`KanbanBoardView.tsx`, opened via `openKanbanBoardInNewTab` into its own editor-tab webview panel instance) is explicitly out of scope: it keeps opening as its own panel via its native toolbar icon, unchanged, and does not get a rail entry.
2. **Rail contents.** Icon-only nav for real features only: Tasks (Board) / Settings / Marketplace. No labels, no logo row, no placeholder "Agents"/"LLMs"/multi-project entries from the mockup — they have no equivalent in this extension. This follows VS Code's own Activity Bar convention (icon-only, tooltip, active-state highlight) and fits sidebars as narrow as ~300px, where the mockup's labeled rail would not.
3. **Chat dock.** A real persistent dock, but single-focus underneath exactly like today: one task streams/executes at a time. `ClineProvider.ts` task concurrency, the single-open-task invariant in `createTask()`, `TaskRegistry.ts`, and the single-current-task shape of `ExtensionStateContext.tsx` are all untouched. The dock's task-switcher chips trigger the same `showTaskWithId` message flow `TaskBoardCard.tsx`/`TaskItem.tsx` already send today — no new backend message. This is purely a frontend/layout change: the message thread that used to render full-screen now renders inside a bounded-height docked panel.
4. **Theming.** Layout/spacing/card/chip language adapted through VS Code CSS variables (`bg-vscode-*` Tailwind tokens, the same convention already used by `TaskBoardCard.tsx`/`TaskBoardColumn.tsx`/`KanbanBoardView.tsx`), not the mockup's fixed purple/indigo branding. Must work in both VS Code light and dark themes.

## Research findings

- `Tab.tsx`'s `Tab` component is hardcoded `fixed inset-0 flex flex-col`. Every top-level view (`SettingsView`, `MarketplaceView`, `TaskBoardView`, `KanbanBoardView`) wraps itself in `<Tab>` and thereby claims the full viewport. `ChatView.tsx` does not use `<Tab>` — it hardcodes an equivalent `fixed ...` class itself, and is the only view kept permanently mounted today (toggled via an `isHidden` prop, not unmounted), with an explicit comment explaining why ("expensive", "state we don't want to lose").
- `App.tsx` renders `Board`/`Settings`/`Marketplace`/`Kanban` as conditionally-rendered siblings gated by `tab === "x"`, plus an always-mounted `ChatView` toggled via `isHidden={tab !== "chat"}`. `tabsByMessageAction` maps native-toolbar-icon `action` messages (`boardButtonClicked`, `settingsButtonClicked`, `marketplaceButtonClicked`, `chatButtonClicked`) to tab switches. `WelcomeView`/MDM-compliance-gating/mobile-mode gating (`isMobileMode`, `isSetupGatedTab`) wrap/precede tab rendering today.
- `openKanbanBoardInNewTab` (`src/activate/registerCommands.ts`) opens a **brand-new editor-tab webview panel** (a whole separate `App.tsx` render tree, via `openClineInNewTab`) and posts `switchTab`/`"kanban"` to that new panel instance. It is never rendered as a pane inside an existing shell/sidebar instance — confirming decision 1's "opens in a separate VS Code webview panel."
- `ChatView.tsx` (1909 lines) reads `clineMessages`/`currentTaskItem` from `useExtensionState()` — a single global snapshot, not keyed by taskId, unchanged per decision 3. Its props today are `{ isHidden, showAnnouncement, hideAnnouncement }` plus a `ref` exposing `acceptInput()`. `webview-ui/src/components/mobile/MobileApp.tsx` also renders `<ChatView isHidden={false} .../>` directly and unmodified for the mobile-server shell (out of scope, untouched) — this is a **second, independent consumer** of `ChatView`'s current (full-screen, `!task` welcome-screen) behavior that must keep working exactly as-is.
- `ChatView.tsx` has **six** existing spec files exercising its internals in depth: `ChatView.spec.tsx`, `ChatView.preserve-images.spec.tsx`, `ChatView.scroll-debug-repro.spec.tsx`, `ChatView.notification-sound.spec.tsx`, `ChatView.keyboard-fix.spec.tsx`, `ChatView.clear-approval-buttons.spec.tsx`. Given `MobileApp.tsx`'s hard dependency on `ChatView`'s current default behavior and this large existing test surface, the lowest-risk extraction that still satisfies "don't duplicate the message-rendering/input logic between two components" is: **add a `variant` prop to `ChatView` itself** (`"standalone"` default = today's exact behavior, unchanged; `"docked"` = new bounded-height mode) rather than moving/deleting the component. `ChatDock.tsx` becomes a thin wrapper that renders `<ChatView variant="docked" ... />` inside the dock chrome (chips row, capped-height container). This is the same pattern `Tab.tsx` gets in this doc (default-preserving `variant` prop) applied to `ChatView`, and it means all six existing spec files keep testing the default variant unchanged, while `ChatDock` gets its own new spec.
- `ChatTextArea.tsx` imports the `MAX_IMAGES_PER_MESSAGE` constant from `./ChatView` — another reason not to delete/move the file wholesale.
- `TaskBoardCard.tsx`'s stage control already uses `Select`/`SelectTrigger`/`SelectValue` with a swatch-dot + label; `boardStage.ts`'s `COLUMNS` already defines `bg-vscode-charts-{blue,purple,yellow,green}` / `bg-vscode-descriptionForeground` swatches, and the underlying `--color-vscode-charts-blue`/`purple` `@theme` tokens are already registered in `index.css` (fixed by the prior board redesign) — so Tailwind opacity modifiers (`bg-vscode-charts-blue/15`) work out of the box for pill styling.

## `Tab.tsx`: shell-aware variant

Add a `variant?: "standalone" | "shell"` prop to `Tab`, default `"standalone"` (today's exact `fixed inset-0 flex flex-col`):

```tsx
type TabProps = HTMLAttributes<HTMLDivElement> & { variant?: "standalone" | "shell" }

export const Tab = ({ className, children, variant = "standalone", ...props }: TabProps) => (
	<div
		className={cn(variant === "shell" ? "flex-1 min-h-0 flex flex-col" : "fixed inset-0 flex flex-col", className)}
		{...props}>
		{children}
	</div>
)
```

Consumers rendered inside the new shell (`TaskBoardView`, `SettingsView`, `MarketplaceView`) change `<Tab>` → `<Tab variant="shell">`, one line each. `KanbanBoardView.tsx` and `WelcomeView.tsx` (not rendered inside the shell) keep the default and are untouched.

## `ChatView.tsx`: docked variant

Add `variant?: "standalone" | "docked"` to `ChatViewProps`, default `"standalone"`. Two conditionals change:

1. **Outer container class** — docked mode fills its flex parent instead of pinning to the viewport:
   ```tsx
   className={
     isHidden
       ? "hidden"
       : variant === "docked"
         ? "flex flex-col h-full min-h-0 overflow-hidden"
         : "fixed top-0 left-0 right-0 bottom-0 flex flex-col overflow-hidden"
   }
   ```
2. **`!task` welcome screen** — the `RooHero`/`RooTips`/`HistoryPreview`/`VersionIndicator` block only renders in `"standalone"` mode. In `"docked"` mode this block is skipped entirely: the idle dock's "content" *is* the already-unconditionally-rendered `ChatTextArea` at the bottom of the component, satisfying decision 3's "shows just an idle-state input." `HistoryPreview` (recent-tasks list) is redundant with the Board, which is now always one rail-click away and is the actual default landing pane. The `{!task && showWorktreesInHomeScreen && <WorktreeSelector />}` block is **kept** in both variants — it's functional (choosing a worktree before starting a task), not decorative chrome, so it stays available in the docked idle state too.

Everything else in `ChatView.tsx` — all message-handling hooks, `TaskHeader`, the `Virtuoso` message list, `FileChangesPanel`, approve/reject buttons, `ChatTextArea` — is unchanged and shared by both variants. `MobileApp.tsx` (which never passes `variant`) is byte-for-byte unaffected.

## New `webview-ui/src/components/shell/`

### `AppShell.tsx`

```tsx
<div className="fixed inset-0 flex">
	<Rail activeTab={...} onNavigate={...} />
	<div className="flex-1 min-w-0 flex flex-col">
		{paneContent}
		<ChatDock ref={chatDockRef} showAnnouncement={...} hideAnnouncement={...} />
	</div>
</div>
```

`paneContent` is passed in as `children` (or a dedicated prop) by `App.tsx` — `AppShell` itself stays presentational and doesn't know about `Board`/`Settings`/`Marketplace` as concepts, keeping the dependency direction the same as today (`App.tsx` owns tab/routing state; the shell just lays it out).

### `Rail.tsx`

Icon-only vertical nav, three entries: Tasks (Board), Settings, Marketplace. Each is a button with:
- An icon (lucide-react, matching the existing toolbar codicon choice per entry: `LayoutGrid` for Board (`$(layout)`), `Settings` for Settings (`$(settings-gear)`), `Store` for Marketplace (`$(extensions)`)).
- A `StandardTooltip` (the existing primitive, per decision 2) showing the localized label, `side="right"`.
- Active-state highlight via `bg-vscode-list-activeSelectionBackground` when `activeTab` matches that entry's tab.
- `aria-label` for accessibility (screen readers, since there's no visible text label).

Styled with `bg-vscode-sideBar-background` and a `border-r border-vscode-panel-border`, narrow (e.g. `w-11`), fits comfortably in a 300px sidebar per decision 2.

### `ChatDock.tsx`

```tsx
<div className="border-t border-vscode-panel-border bg-vscode-editor-background flex flex-col max-h-[40vh] min-h-[220px]">
	<TaskChipRow ... />
	<ChatView ref={ref} variant="docked" isHidden={false} showAnnouncement={...} hideAnnouncement={...} />
</div>
```

- Forwards `ChatViewRef` straight through to the inner `ChatView` so `App.tsx`'s existing `chatViewRef.current?.acceptInput()` (driven by the `"acceptInput"` extension message) keeps working unchanged.
- `isHidden` is always `false` — the dock has no sibling competing for the same screen region anymore, so there's nothing to hide it from; it is always mounted whenever the shell is.
- **Task-switcher chips**: derived client-side from the existing `taskHistory` array already in `ExtensionStateContext` (most-recent-`ts`-first, capped to a handful, e.g. 6), with no new backend message and no new persisted state — "recently focused" is approximated as "recently active," which `taskHistory`'s `ts` field already orders correctly by construction (every task-history write bumps `ts`). The current task (`currentTaskItem?.id`) is visually marked active in its chip; clicking any other chip posts the existing `{ type: "showTaskWithId", text: taskId }`, exactly like `TaskBoardCard.tsx` does today. When `taskHistory` is empty, the chip row renders nothing (not an empty placeholder bar).

### `TaskChip.tsx`

Small presentational component: truncated task text, active-state ring/background when it's the current task, click handler. No new message types.

## `App.tsx` changes

- Replace the `tab === "board" && ...` / `tab === "settings" && ...` / `tab === "marketplace" && ...` / always-mounted `<ChatView isHidden=.../>` sibling fragment with `<AppShell>` wrapping pane routing:
  - `tab === "board"` → `<TaskBoardView onDone={() => switchTab("chat")} />`
  - `tab === "settings"` → `<SettingsView ... />`
  - `tab === "marketplace"` → `<MarketplaceView ... />`
  - `tab === "chat"` → no pane content (`null`) — the dock is always visible regardless of `tab`; landing on "chat" simply means no side pane is showing, giving the dock the whole content column. This is the natural new meaning of the native chat toolbar button and of every view's existing "done" back-arrow (`onDone={() => switchTab("chat")}`), both of which are otherwise **unchanged** call sites.
- `tab === "kanban"` is pulled **out** of the shell entirely — per decision 1, it renders `<KanbanBoardView rootTaskId={kanbanRootTaskId} onDone={() => switchTab("chat")} />` as an alternate top-level branch, standalone (default `Tab` variant), exactly as it does today. In practice `tab === "kanban"` is only ever reached in the separate editor-tab panel instance `openKanbanBoardInNewTab` spins up, but the branch is kept in the shared `App.tsx` component (both panel instances render the same component tree) rather than duplicating `App.tsx`.
- `tabsByMessageAction` mapping (`chatButtonClicked`/`settingsButtonClicked`/`boardButtonClicked`/`marketplaceButtonClicked` → tab) is unchanged — native toolbar icons keep working exactly as today.
- `WelcomeView`/MDM gating/`isSetupGatedTab`/mobile gating (`isMobileMode`) are unchanged and continue to wrap/precede the shell.
- The `shouldShowAnnouncement` effect drops its `tab === "chat"` condition (`if (shouldShowAnnouncement && tab === "chat")` → `if (shouldShowAnnouncement)`), since the component that renders the announcement banner (now inside `ChatDock`, via `ChatView`) is mounted regardless of which pane `tab` selects, not just when `tab === "chat"`.
- `chatViewRef` (typed `ChatViewRef`) is now passed to `ChatDock` instead of `ChatView` directly; `ChatDock` forwards it straight through.

## Visual polish: `TaskBoardCard.tsx` / `TaskBoardColumn.tsx`

Purely visual, no message-contract changes:
- ~~`TaskBoardCard`'s stage `Select`'s `SelectTrigger` gets pill styling driven by the column's existing swatch color~~ — **superseded.** The per-card stage `Select` was removed in favour of drag-and-drop (below), taking the `pillClassName` lookup on `boardStage.ts`'s `BoardColumn` with it; `swatchClassName` remains its stage → styling source of truth.
- Card corners already matched the reference's rounded-card language (`rounded-xl`) before this change, so no structural change there.
- No change to `taskBoardStageChanged`, deletion, or selection message contracts.

## Moving cards between columns: drag-and-drop

Replaces the per-card stage `Select`. Native HTML5 drag-and-drop, no new dependency:
- `boardDrag.ts` owns the transfer contract — a private `application/x-zoo-board-task` MIME carrying `{ taskId, stage }`, so a column ignores unrelated drags and can distinguish a real column change from a drop back into the card's own column (a no-op, since `BoardStore.updateTask` reassigns `position` on every stage write).
- `TaskBoardCard` is `draggable` and dims while dragging, except while its title/description has focus — otherwise those fields could not be selected with the mouse.
- `TaskBoardColumn` is the drop target across its whole body (header included) and rings itself in `vscode-focusBorder` while a card hovers it. The drop posts the same `updateBoardTask` message the `Select` used to, so the message contract is unchanged.

## i18n

New namespace `webview-ui/src/i18n/locales/en/shell.json` (English required now; matches the existing 18-locale glob convention — `i18n/setup.ts` globs `./locales/**/*.json` and falls back to English via `fallbackLng: "en"` for any locale missing the file) for:
- Rail tooltips/aria-labels (`rail.tasks`, `rail.settings`, `rail.marketplace`).
- Dock idle-state copy (if any beyond the existing `chat:typeTask` placeholder already reused).
- Task-chip aria-labels.

Existing `board:*` and `chat:*` keys are reused as-is wherever they already say the right thing (e.g. `chat:typeTask`/`chat:typeMessage` placeholders stay the input's placeholder text unchanged).

## Tests

- `webview-ui/src/__tests__/App.spec.tsx` — substantial rewrite: the "each tab is a conditionally-rendered full-screen sibling, `ChatView` always mounted with `isHidden`" assumptions no longer hold for `board`/`settings`/`marketplace`. `ChatView` itself is no longer imported/mocked directly by `App.tsx`; `App.tsx` now mocks `AppShell`/`ChatDock` (or lets `AppShell` render for real with `Rail`/pane-mock children — implementation picks whichever keeps the suite fast and focused on routing behavior, not pixel layout). Tab-switch/welcome-gating/import-redirect assertions are preserved in spirit (same scenarios), adapted to the new render tree.
- New `webview-ui/src/components/shell/__tests__/AppShell.spec.tsx`, `Rail.spec.tsx`, `ChatDock.spec.tsx` — rail active-state + navigation click behavior, dock chip rendering/click → `showTaskWithId`, dock always-visible behavior.
- `ChatView`'s six existing spec files are **not** rewritten — they continue to test the unchanged default (`"standalone"`) variant. `ChatDock.spec.tsx` covers the new `"docked"` variant's incremental behavior (container sizing, chip row, suppressed welcome screen) rather than re-testing message-handling internals already covered by `ChatView`'s suite.
- `webview-ui/src/__tests__/App.mobile.spec.tsx` — unaffected (mobile branch returns before the shell is reached); re-run to confirm no regression, no rewrite expected.

## Verification

1. Build `packages/types`, the extension host (`src`), and `webview-ui`; fix any type errors.
2. Run unit tests for both the extension host and webview-ui workspaces.
3. No manual F5 dev-host walkthrough (no display available in this environment) — builds/type-checks clean and tests passing is the bar for this pass.
