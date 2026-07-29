# UI design handoff — workspace-first Tasks board

## Design intent

Tasks is a logical-workspace planning surface, not chat history or the standalone per-task Kanban. Preserve the existing VS Code-token palette, rounded cards, five fixed stages, and persistent shell. Board data and controls are always scoped to the selected logical board workspace; no visual control should imply a VS Code folder is selected or changed.

## Responsive composition

| Context | Layout |
| --- | --- |
| Narrow sidebar | Retain the icon rail and chat dock. The Tasks pane header stacks into compact rows when needed: workspace selector/action menu first, then search and primary actions. Keep all five columns at a stable minimum width (about 272 px) in a single non-wrapping horizontal strip; expose horizontal scrolling rather than collapsing or vertically reordering stages. |
| Editor tab | Use the same five-column strip, filling available width while retaining the column minimum. Header controls may remain in one row when space permits. Do not create a second desktop-only interaction model. |

The scrollable board region owns horizontal scrolling; column lists own vertical scrolling. Keep the header and dock outside that scroll region.

## First-use: create workspace

When there is no selected workspace, center a compact, single-column planning card:

- Heading: **Tasks**; supporting copy: **Create a workspace to start planning.**
- Required workspace-name field with visible required indication and inline validation. Disable **Create workspace** until its trimmed value is non-empty.
- Optional folder-link action/field, visually secondary and labelled as planning context only. It must not suggest it changes the open VS Code folder.
- Primary **Create workspace** action creates and selects the logical workspace. Keyboard submit is available only when the name is valid.
- On validation or host failure, retain entered values, focus the invalid/error summary or field, and announce the error.

## Selected-workspace header

- Workspace selector displays the selected workspace name and supports keyboard selection.
- Place workspace management in an adjacent labelled action menu: **New workspace**, **Rename**, **Link/change folder** (optional), and destructive **Delete workspace**. Deletion requires confirmation that explains it removes board workspaces/cards only, never execution history or VS Code folders.
- Keep **Plan with AI**, **New task**, and workspace-scoped search visibly distinct from workspace management. **New task** adds an empty Backlog card and moves focus to its title field.
- Until the dedicated non-execution planning runtime exists, render **Plan with AI** disabled with explanatory tooltip/description: “Planning chat is not available yet.” It must not post a normal task/new-chat action, create history, or appear to be a recoverable form error.

## Columns and cards

Keep ordered columns: Backlog, Scoped, Approved, In Progress, Done. Retain the established neutral/blue/purple/yellow/green swatches and coloured stage-pill language; text and selection affordances must remain legible in both VS Code light and dark themes.

- Every column header includes its stage label, item count, and an icon-plus-label-or-tooltip **Add task** button. Its accessible name includes the destination stage, for example “Add task to Scoped”.
- Activating **Add task** immediately saves/inserts a blank card in that column, scrolls it into view if necessary, and focuses its inline title field. It does not open chat or an execution task.
- A blank card displays an inline title input with placeholder **Untitled task**. It is an ordinary persisted task: it can be moved, reloaded, and deleted before receiving a title.
- Clicking or tabbing to a blank card enters/retains inline editing; never route this interaction through `showTaskWithId`. Persist title/description on blur or explicit save, without losing a deliberate empty title.
- The manual stage control is independent from card editing and prevents event propagation. Moving a blank card remains permitted. Start-task is disabled for blank/whitespace-only titles.
- An unlinked titled card presents **Start task** as the explicit execution handoff. A linked card replaces that affordance with **Open task**. Card deletion is board-only and never implies execution-history deletion.

## Focus, keyboard, and accessibility

- Use semantic buttons, labelled inputs, native/accessible Select behaviour, and visible VS Code-theme focus rings. Icon-only actions require `aria-label` and tooltip; tooltips supplement, never replace, names.
- After creating a workspace, move focus to the selected-workspace control or first meaningful board action. After adding a task, focus the new title input. After delete confirmation, restore focus to the originating header/card control; if its column is empty, restore focus to that column’s Add task control.
- Ensure stage, workspace, and action menus work by keyboard; Escape closes menus/dialogs without mutation. The title input and description editor have explicit accessible names.
- Announce asynchronous creates, moves, links, deletes, and failure states through an appropriate polite/error live region. Do not rely on swatch colour alone: retain text stage labels and use readable contrast.
- Preserve the five-column visual order in DOM/focus order. Horizontal scroll must be keyboard reachable; do not trap focus inside a column or the dock.

## Acceptance visual states

| State | Visible result |
| --- | --- |
| No workspace | Centered creation card, disabled Create until a name is supplied, optional folder link clearly secondary. |
| Selected empty workspace | Full five-column strip with zero counts and each column’s accessible Add task action; no history-derived cards or filesystem workspace filter. |
| New blank card | Card appears in the requested column, title input is focused, `Untitled task` placeholder is visible, Start task disabled. |
| Edited/moved blank card | Inline title stays editable; stage selection moves the same card without launching chat; card remains after reload. |
| Titled unlinked card | Start task enabled and visually clear as an execution boundary. |
| Linked card | Open task replaces Start task; normal card controls remain available. |
| Planning unavailable | Disabled Plan with AI plus explanatory tooltip/text; no normal execution task is created. |
| Narrow sidebar | Rail, compact header, and dock remain intact; five fixed columns are horizontally scrollable with no vertical stage collapse. |
| Editor tab | Same content and control semantics expand across available width; no divergent layout or interaction model. |
| Error/destructive action | Inline/status error is announced and preserves user input; workspace deletion uses confirmation and explicitly states board-only impact. |
