import { memo, useMemo, useState } from "react"
import { Plus } from "lucide-react"

import type { BoardTask, ModeConfig } from "@roo-code/types"
import { getAllModes } from "@roo/modes"

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@/lib/utils"
import { vscode } from "@/utils/vscode"

import { hasBoardTaskDrag, readBoardTaskDrag } from "./boardDrag"
import type { BoardColumn } from "./boardStage"
import TaskBoardCard from "./TaskBoardCard"

const USE_CURRENT_MODE = "__use_current_mode__"

const TaskBoardColumn = ({
	column,
	tasks,
	workspaceId,
	customModes,
	mode,
}: {
	column: BoardColumn
	tasks: BoardTask[]
	workspaceId: string
	customModes: ModeConfig[]
	/** The mode every card in this column runs in; undefined uses the current mode. */
	mode?: string
}) => {
	const { t } = useAppTranslation()
	const modes = useMemo(() => {
		const availableModes = getAllModes(customModes)
		// A column can outlive the mode it was pointed at, so a deleted mode stays
		// visible rather than silently reading as "use current mode".
		return mode && !availableModes.some((available) => available.slug === mode)
			? [{ slug: mode, name: `Unavailable: ${mode}` }, ...availableModes]
			: availableModes
	}, [customModes, mode])
	const [isDropTarget, setIsDropTarget] = useState(false)
	return (
		<div
			data-testid={`board-column-${column.stage}`}
			onDragOver={(event) => {
				if (!hasBoardTaskDrag(event.dataTransfer)) return
				// Only preventDefault marks this as a valid drop target; without it the
				// browser rejects the drop and no drop event ever fires.
				event.preventDefault()
				event.dataTransfer.dropEffect = "move"
				setIsDropTarget(true)
			}}
			onDragLeave={(event) => {
				// Crossing between a card and the column's padding fires dragleave on the
				// column itself, so only a leave that actually exits the column counts.
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDropTarget(false)
			}}
			onDrop={(event) => {
				const dragged = readBoardTaskDrag(event.dataTransfer)
				setIsDropTarget(false)
				if (!dragged) return
				event.preventDefault()
				// Dropping a card back into its own column would otherwise send it to the
				// bottom, since the store reassigns position on every stage write.
				if (dragged.stage === column.stage) return
				vscode.postMessage({
					type: "updateBoardTask",
					taskId: dragged.taskId,
					boardTask: { stage: column.stage },
				})
			}}
			className={cn(
				"flex h-full w-[272px] shrink-0 flex-col overflow-hidden rounded-xl border bg-vscode-sideBar-background",
				isDropTarget ? "border-vscode-focusBorder ring-1 ring-vscode-focusBorder" : "border-vscode-panel-border",
			)}>
			<div className="flex flex-col gap-2 border-b border-vscode-panel-border px-3 py-3">
				<div className="flex items-center justify-between">
					<h4 className="m-0 flex items-center gap-2 text-sm font-semibold text-vscode-foreground">
						<span className={cn("inline-block size-2 shrink-0 rounded-full", column.swatchClassName)} />
						{t(column.labelKey)}
					</h4>
					<Button
						variant="ghost"
						className="size-7 p-0"
						aria-label={`Add task to ${t(column.labelKey)}`}
						onClick={() =>
							vscode.postMessage({
								type: "createBoardTask",
								workspaceId,
								boardTask: { stage: column.stage },
							})
						}>
						<Plus className="size-4" />
					</Button>
				</div>
				<Select
					value={mode ?? USE_CURRENT_MODE}
					onValueChange={(selected) =>
						vscode.postMessage({
							type: "setBoardColumnMode",
							workspaceId,
							stage: column.stage,
							mode: selected === USE_CURRENT_MODE ? undefined : selected,
						})
					}>
					<SelectTrigger className="h-6 w-full text-xs" aria-label={`Mode for ${t(column.labelKey)}`}>
						<SelectValue placeholder="Use current mode" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={USE_CURRENT_MODE}>Use current mode</SelectItem>
						{modes.map((available) => (
							<SelectItem key={available.slug} value={available.slug}>
								{available.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="flex min-h-[40px] flex-1 flex-col gap-2 overflow-y-auto p-2.5">
				{tasks.map((task) => (
					<TaskBoardCard key={task.id} task={task} />
				))}
			</div>
		</div>
	)
}

export default memo(TaskBoardColumn)
