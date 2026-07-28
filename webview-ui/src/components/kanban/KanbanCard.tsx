import type { KanbanItem } from "@roo-code/types"

import { cn } from "@/lib/utils"
import { vscode } from "@/utils/vscode"

const RELATED_TASK_STATUS_LABEL: Record<string, string> = {
	active: "Active",
	completed: "Completed",
	delegated: "Delegated",
	interrupted: "Interrupted",
}

// Reflects the linked subtask's own real execution state, independent of which column the card
// is sitting in - e.g. a card can be in the Testing column while its subtask already shows
// "Completed" here. Same yellow/green language as the column swatches; interrupted gets red
// since it signals something needs attention (see the abandonSubtask recovery path).
const RELATED_TASK_STATUS_DOT: Record<string, string> = {
	active: "bg-vscode-charts-yellow",
	delegated: "bg-vscode-charts-yellow",
	completed: "bg-vscode-charts-green",
	interrupted: "bg-vscode-charts-red",
}

interface KanbanCardProps {
	item: KanbanItem
}

export const KanbanCard = ({ item }: KanbanCardProps) => {
	const isInert = !item.relatedTaskId

	const handleClick = () => {
		if (item.relatedTaskId) {
			vscode.postMessage({ type: "showTaskWithId", text: item.relatedTaskId })
		}
	}

	return (
		<div
			onClick={isInert ? undefined : handleClick}
			className={cn(
				"rounded-lg border p-2.5 flex flex-col gap-1.5 bg-vscode-input-background border-vscode-panel-border",
				isInert
					? "opacity-50"
					: "cursor-pointer hover:bg-vscode-input-background/70 hover:border-vscode-focusBorder transition-colors",
			)}>
			<div className="text-sm text-vscode-foreground break-words">{item.content}</div>
			{item.relatedTask && (
				<div className="flex items-center justify-between gap-2 text-xs text-vscode-descriptionForeground">
					<span className="flex items-center gap-1.5 font-medium">
						<span
							className={cn(
								"inline-block size-1.5 rounded-full shrink-0",
								RELATED_TASK_STATUS_DOT[item.relatedTask.status ?? ""] ??
									"bg-vscode-descriptionForeground",
							)}
						/>
						{RELATED_TASK_STATUS_LABEL[item.relatedTask.status ?? ""] ?? item.relatedTask.status}
					</span>
					<span className="tabular-nums">${item.relatedTask.totalCost.toFixed(2)}</span>
				</div>
			)}
		</div>
	)
}

export default KanbanCard
