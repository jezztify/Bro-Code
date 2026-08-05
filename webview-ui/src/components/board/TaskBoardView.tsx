import { memo, useMemo, useState } from "react"
import { FolderPlus, LayoutDashboard, PictureInPicture2, Plus } from "lucide-react"

import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { formatLargeNumber } from "@/utils/format"
import { vscode } from "@/utils/vscode"

import { Tab, TabContent, TabHeader } from "../common/Tab"

import BoardActivityColumn from "./BoardActivityColumn"
import BoardManagerCard from "./BoardManagerCard"
import { COLUMNS, compareBoardTasks } from "./boardStage"
import { sumBoardWorkspaceTokens } from "./boardTokenTotals"
import TaskBoardColumn from "./TaskBoardColumn"

/**
 * Shared by the first-run empty state and the header's New workspace action, so
 * creating the second workspace works the same way as creating the first.
 */
const WorkspaceCreateForm = ({ onDismiss }: { onDismiss?: () => void }) => {
	const [workspaceName, setWorkspaceName] = useState("")
	const [folderPath, setFolderPath] = useState("")
	const create = () => {
		vscode.postMessage({
			type: "createBoardWorkspace",
			workspaceName,
			linkedWorkspacePath: folderPath || undefined,
		})
		setWorkspaceName("")
		setFolderPath("")
		onDismiss?.()
	}
	return (
		<>
			<VSCodeTextField
				value={workspaceName}
				placeholder="Workspace name"
				aria-label="Workspace name"
				onInput={(event) => setWorkspaceName((event.target as HTMLInputElement).value)}
				onKeyDown={(event: React.KeyboardEvent) => {
					if (event.key === "Enter" && workspaceName.trim()) create()
					if (event.key === "Escape") onDismiss?.()
				}}
			/>
			<VSCodeTextField
				value={folderPath}
				placeholder="Optional folder path"
				aria-label="Workspace folder path"
				onInput={(event) => setFolderPath((event.target as HTMLInputElement).value)}
			/>
			<div className="flex gap-2">
				<Button variant="primary" className="flex-1" disabled={!workspaceName.trim()} onClick={create}>
					Create workspace
				</Button>
				{onDismiss && (
					<Button variant="secondary" onClick={onDismiss}>
						Cancel
					</Button>
				)}
			</div>
		</>
	)
}

const TaskBoardView = () => {
	const { t } = useAppTranslation()
	const { boardState, boardPlanning, customModes, taskHistory, runningTaskIds, awaitingTaskIds, listApiConfigMeta } =
		useExtensionState()
	const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false)
	const [search, setSearch] = useState("")
	const selectedWorkspace = boardState.workspaces.find((workspace) => workspace.id === boardState.selectedWorkspaceId)
	// Pushed by the extension host as runs start and end, so an In Progress card whose
	// run is no longer live re-renders from Stop back to Start without a reload.
	const runningTaskIdSet = useMemo(() => new Set(runningTaskIds ?? []), [runningTaskIds])
	// A run that has stopped to ask the user something is still live, so it is a subset
	// of the above rather than a state of its own: the card stays stoppable, but says
	// what it is actually waiting for.
	const awaitingTaskIdSet = useMemo(() => new Set(awaitingTaskIds ?? []), [awaitingTaskIds])
	const workspaceTasks = useMemo(
		() => (selectedWorkspace ? boardState.tasks.filter((task) => task.workspaceId === selectedWorkspace.id) : []),
		[boardState.tasks, selectedWorkspace],
	)
	// Ordering is per column (see compareBoardTasks), so this only narrows the cards.
	const tasks = useMemo(() => {
		const query = search.trim().toLowerCase()
		return query
			? workspaceTasks.filter(
					(task) =>
						task.title.toLowerCase().includes(query) || task.description?.toLowerCase().includes(query),
				)
			: workspaceTasks
	}, [search, workspaceTasks])
	// The log is a record of what happened, not a view of the cards, so the search box
	// deliberately does not narrow it — but it is still scoped to the open workspace.
	const activity = useMemo(
		() =>
			selectedWorkspace
				? (boardState.activity ?? []).filter((entry) => entry.workspaceId === selectedWorkspace.id)
				: [],
		[boardState.activity, selectedWorkspace],
	)
	// Every card counts toward the workspace total, including the ones the search
	// box is currently hiding.
	const tokenTotals = useMemo(
		() =>
			selectedWorkspace
				? sumBoardWorkspaceTokens(boardState.tasks, taskHistory ?? [], selectedWorkspace.id)
				: { tokensIn: 0, tokensOut: 0 },
		[boardState.tasks, taskHistory, selectedWorkspace],
	)

	if (!selectedWorkspace)
		return (
			<Tab variant="shell" className="bg-vscode-editor-background">
				<TabContent className="flex items-center justify-center p-6">
					<div className="w-full max-w-md space-y-3 rounded-lg border border-vscode-panel-border bg-vscode-sideBar-background p-5">
						<h2 className="m-0 flex items-center gap-2 text-base font-semibold">
							<LayoutDashboard className="size-5" />
							{t("board:title")}
						</h2>
						<p className="m-0 text-sm text-vscode-descriptionForeground">
							Create a workspace to start planning.
						</p>
						<WorkspaceCreateForm />
					</div>
				</TabContent>
			</Tab>
		)

	const planning = boardPlanning?.workspaceId === selectedWorkspace.id ? boardPlanning : undefined
	return (
		<Tab variant="shell" className="bg-vscode-editor-background">
			<TabHeader className="flex shrink-0 flex-col gap-3 bg-vscode-sideBar-background px-5 py-3">
				{/* flex-wrap so a phone-width viewport (the mobile server serves this same
				board over the LAN) breaks the two groups onto separate lines. Without it
				the left group's min-w-0 lets it be crushed to a fraction of its content
				width while its children keep their natural size, so the workspace picker
				and New workspace button paint straight over the token counts and New task. */}
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex min-w-0 items-center gap-2">
						<LayoutDashboard className="size-5 shrink-0" />
						<Select
							value={selectedWorkspace.id}
							onValueChange={(workspaceId) =>
								vscode.postMessage({ type: "selectBoardWorkspace", workspaceId })
							}>
							<SelectTrigger className="h-8 max-w-56">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{boardState.workspaces.map((workspace) => (
									<SelectItem key={workspace.id} value={workspace.id}>
										{workspace.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Button
							variant="secondary"
							aria-label="New workspace"
							onClick={() => setIsCreatingWorkspace((creating) => !creating)}>
							<FolderPlus className="mr-1 size-4" />
							New workspace
						</Button>
					</div>
					<div className="flex items-center gap-3">
						<div
							data-testid="board-workspace-tokens"
							title={`Tokens used by this workspace: ${tokenTotals.tokensIn.toLocaleString()} in, ${tokenTotals.tokensOut.toLocaleString()} out (includes subtasks)`}
							className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-vscode-descriptionForeground">
							<span>↑ {formatLargeNumber(tokenTotals.tokensIn)}</span>
							<span>↓ {formatLargeNumber(tokenTotals.tokensOut)}</span>
						</div>
						<Button
							variant="secondary"
							aria-label="Open board in new window"
							title="Open the board in its own window"
							onClick={() => vscode.postMessage({ type: "openBoardInWindow" })}>
							<PictureInPicture2 className="size-4" />
						</Button>
						<Button
							variant="primary"
							onClick={() =>
								vscode.postMessage({
									type: "createBoardTask",
									workspaceId: selectedWorkspace.id,
									boardTask: { stage: "backlog" },
								})
							}>
							<Plus className="mr-1 size-4" />
							New task
						</Button>
					</div>
				</div>
				{isCreatingWorkspace && (
					<div className="space-y-2 rounded-md border border-vscode-panel-border bg-vscode-editor-background p-3">
						<p className="m-0 text-sm font-medium">New workspace</p>
						<WorkspaceCreateForm onDismiss={() => setIsCreatingWorkspace(false)} />
					</div>
				)}
				<div className="flex gap-2">
					<VSCodeTextField
						className="flex-1"
						value={search}
						placeholder={t("board:searchPlaceholder")}
						onInput={(event) => setSearch((event.target as HTMLInputElement).value)}
					/>
					{selectedWorkspace.linkedWorkspacePath && (
						<Button
							variant="secondary"
							onClick={() =>
								vscode.postMessage({
									type: "updateBoardWorkspace",
									workspaceId: selectedWorkspace.id,
									linkedWorkspacePath: "",
								})
							}>
							Clear folder
						</Button>
					)}
					<Button
						variant="destructive"
						onClick={() =>
							vscode.postMessage({ type: "deleteBoardWorkspace", workspaceId: selectedWorkspace.id })
						}>
						Delete
					</Button>
				</div>
				{planning && (
					<div
						className="rounded-md border border-vscode-panel-border bg-vscode-editor-background p-3 text-sm"
						role="status">
						<p className="m-0 font-medium">
							{planning.status === "awaiting_approval"
								? "Review the AI plan before adding cards."
								: "AI planning is in progress."}
						</p>
						{planning.assistantText && (
							<p className="mb-2 mt-1 whitespace-pre-wrap text-vscode-descriptionForeground">
								{planning.assistantText}
							</p>
						)}
						{planning.status === "awaiting_approval" && (
							<Button
								variant="primary"
								onClick={() => vscode.postMessage({ type: "approveBoardPlanning" })}>
								Approve plan and add cards
							</Button>
						)}
						{planning.error && <p className="mb-0 mt-1 text-vscode-errorForeground">{planning.error}</p>}
					</div>
				)}
			</TabHeader>
			<TabContent className="bg-vscode-editor-background px-4 py-4">
				<div className="flex h-full min-w-max gap-4 overflow-x-auto pr-2">
					{/* The manager and the log share one column: neither holds cards, and both
					are about the board as a whole rather than about any one stage of it. */}
					<div className="flex h-full w-[272px] shrink-0 flex-col gap-4">
						<BoardManagerCard
							workspaceId={selectedWorkspace.id}
							manager={selectedWorkspace.manager}
							tasks={workspaceTasks}
							customModes={customModes}
							apiConfigs={listApiConfigMeta ?? []}
						/>
						<BoardActivityColumn entries={activity} />
					</div>
					{COLUMNS.map((column) => (
						<TaskBoardColumn
							key={column.stage}
							column={column}
							tasks={tasks
								.filter((task) => task.stage === column.stage)
								.sort(compareBoardTasks(column.stage))}
							workspaceId={selectedWorkspace.id}
							customModes={customModes}
							mode={selectedWorkspace.columnModes?.[column.stage]}
							runningTaskIds={runningTaskIdSet}
							awaitingTaskIds={awaitingTaskIdSet}
						/>
					))}
				</div>
			</TabContent>
		</Tab>
	)
}

export default memo(TaskBoardView)
