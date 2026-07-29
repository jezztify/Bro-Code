# Business analysis — workspace-first board planning

## Requested outcome

Replace the history-derived Tasks board with a planning board where users first create a logical workspace, then plan with an LLM, and can create/place blank task cards independently of execution chats.

## Users and workflow

1. User creates and selects a logical board workspace, optionally linking a local folder.
2. User discusses scope with an LLM in that workspace.
3. After explicit approval, the LLM creates planned cards in the selected workspace without starting implementation tasks.
4. User can manually add an empty card directly in any board stage, move it, and edit it later.
5. User explicitly starts a titled card when implementation is wanted; the resulting execution conversation remains linked to that card.

## Functional requirements

- Persist workspace and card data separately from task history.
- Permit empty card titles and card placement before content exists.
- Keep five manual stages: Backlog, Scoped, Approved, In Progress, Done.
- Scope board actions to the selected logical workspace, not to the current VS Code filesystem workspace.
- Retain an optional folder link only as planning context.
- Require explicit approval before LLM card-creation tools run.
- Do not create `HistoryItem` records or execution conversations during planning/card CRUD.
- On completion, move only the board card linked to that execution task to Done.
- Preserve existing execution history, Settings, Marketplace, persistent dock, and standalone per-task Kanban.

## Acceptance criteria

- Users can create/select/rename/delete logical workspaces without changing the VS Code folder.
- Blank cards can be created in every stage, moved, reloaded, and remain blank.
- Approved LLM planning adds cards only to the active workspace and does not create execution tasks.
- Starting a titled card links it to one execution task; completing that task updates only its linked card.
- Existing history records are only imported once into an Imported tasks workspace and are never deleted by board actions.

## Constraints and assumptions

- Existing `HistoryItem.boardStage` and `taskBoardStageChanged` are incompatible with a separate planning source of truth and will be removed during the same delivery.
- Board data remains local extension-global-storage data; cloud collaboration and drag/drop are out of scope.
- The planning implementation needs an explicit non-execution session because normal new-task flow persists a task/history record.
