import { useEffect, useMemo } from "react"
import { ArrowLeft } from "lucide-react"

import type { KanbanItem, TodoStatus } from "@roo-code/types"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"

import { Tab, TabContent, TabHeader } from "../common/Tab"
import { KanbanCard } from "./KanbanCard"

interface KanbanBoardViewProps {
	/** Undefined when opened with no active task (e.g. from the always-available toolbar entry). */
	rootTaskId: string | undefined
	onDone: () => void
}

// Same status -> color language already used for todos elsewhere (TodoChangeDisplay.tsx):
// in_progress = charts-yellow, testing = charts-purple. completed gets charts-green here for
// column-at-a-glance scanning; pending stays neutral since it carries no signal on its own.
const COLUMNS: { status: TodoStatus; labelKey: string; swatchClassName: string }[] = [
	{ status: "pending", labelKey: "chat:kanban.columns.notDone", swatchClassName: "bg-vscode-descriptionForeground" },
	{ status: "in_progress", labelKey: "chat:kanban.columns.inProgress", swatchClassName: "bg-vscode-charts-yellow" },
	{ status: "testing", labelKey: "chat:kanban.columns.testing", swatchClassName: "bg-vscode-charts-purple" },
	{ status: "completed", labelKey: "chat:kanban.columns.done", swatchClassName: "bg-vscode-charts-green" },
]

export const KanbanBoardView = ({ rootTaskId, onDone }: KanbanBoardViewProps) => {
	const { t } = useAppTranslation()
	const { kanbanBoard } = useExtensionState()

	useEffect(() => {
		if (!rootTaskId) {
			return
		}
		vscode.postMessage({ type: "kanbanBoardOpened", text: rootTaskId })
		return () => {
			vscode.postMessage({ type: "kanbanBoardClosed" })
		}
	}, [rootTaskId])

	const isCurrent = !!rootTaskId && kanbanBoard?.rootTaskId === rootTaskId

	const itemsByStatus = useMemo(() => {
		const grouped = new Map<TodoStatus, KanbanItem[]>()
		if (isCurrent && kanbanBoard) {
			for (const item of kanbanBoard.items) {
				const existing = grouped.get(item.status) ?? []
				existing.push(item)
				grouped.set(item.status, existing)
			}
		}
		return grouped
	}, [isCurrent, kanbanBoard])

	return (
		<Tab>
			<TabHeader className="flex flex-row items-center gap-2">
				<Button
					variant="ghost"
					className="px-1.5 -ml-2"
					onClick={onDone}
					aria-label={t("chat:kanban.title")}
					data-testid="kanban-done-button">
					<ArrowLeft />
					<span className="sr-only">{t("chat:kanban.title")}</span>
				</Button>
				<h3 className="text-vscode-foreground m-0">{t("chat:kanban.title")}</h3>
				{isCurrent && kanbanBoard?.rootTaskTitle && (
					<span className="text-xs text-vscode-descriptionForeground border-l border-vscode-panel-border pl-2.5 ml-0.5 truncate">
						{kanbanBoard.rootTaskTitle}
					</span>
				)}
			</TabHeader>
			<TabContent>
				{!rootTaskId ? (
					<div className="flex items-center justify-center h-full text-vscode-descriptionForeground text-sm">
						{t("chat:kanban.noActiveTask")}
					</div>
				) : !isCurrent ? (
					<div className="flex items-center justify-center h-full text-vscode-descriptionForeground text-sm">
						{t("chat:kanban.loading")}
					</div>
				) : (
					<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 h-full">
						{COLUMNS.map((column) => {
							const items = itemsByStatus.get(column.status) ?? []
							return (
								<div key={column.status} className="flex flex-col gap-2 min-w-0">
									<div className="flex items-center justify-between px-0.5">
										<h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-vscode-descriptionForeground m-0">
											<span
												className={cn(
													"inline-block size-1.5 rounded-full shrink-0",
													column.swatchClassName,
												)}
											/>
											{t(column.labelKey)}
										</h4>
										<span className="text-xs text-vscode-descriptionForeground tabular-nums">
											{items.length}
										</span>
									</div>
									<div className="flex flex-col gap-2 flex-1 min-h-[40px]">
										{items.map((item) => (
											<KanbanCard item={item} key={item.id} />
										))}
									</div>
								</div>
							)
						})}
					</div>
				)}
			</TabContent>
		</Tab>
	)
}

export default KanbanBoardView
