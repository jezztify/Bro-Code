import { memo, useMemo } from "react"
import { History } from "lucide-react"

import { formatBoardTaskNumber, type BoardActivityEntry } from "@roo-code/types"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@/lib/utils"

import { STAGE_LABEL_KEYS } from "./boardStage"

/**
 * What the board has been doing, as a column of its own so a move is visible without
 * opening the card it happened to. Holds no cards, so it is deliberately not a
 * {@link BoardColumn}: it takes no drops, runs in no mode, and has nothing to add to.
 */
const BoardActivityColumn = ({ entries }: { entries: readonly BoardActivityEntry[] }) => {
	const { t } = useAppTranslation()
	// The log is stored oldest first; the most recent thing that happened is what a
	// reader wants at the top.
	const newestFirst = useMemo(() => [...entries].reverse(), [entries])
	return (
		<div
			data-testid="board-column-activity"
			className="flex h-full w-[272px] shrink-0 flex-col overflow-hidden rounded-xl border border-vscode-panel-border bg-vscode-sideBar-background">
			<div className="flex flex-col gap-2 border-b border-vscode-panel-border px-3 py-3">
				<h4 className="m-0 flex items-center gap-2 text-sm font-semibold text-vscode-foreground">
					<History className="size-4 shrink-0" />
					{t("board:columns.activityLog")}
				</h4>
			</div>
			<div className="flex min-h-[40px] flex-1 flex-col gap-2 overflow-y-auto p-2.5">
				{newestFirst.length === 0 ? (
					<p className="m-0 px-1 text-xs text-vscode-descriptionForeground">{t("board:activity.empty")}</p>
				) : (
					newestFirst.map((entry) => {
						const taskNumber = formatBoardTaskNumber(entry.taskNumber)
						// A card can be renamed or deleted after the fact, so the log shows the
						// reference it was recorded with rather than looking the card up.
						const reference = taskNumber ?? (entry.taskTitle.trim() || entry.taskId.slice(0, 8))
						const mode = entry.mode ?? t("board:activity.unknownMode")
						const apiConfigName = entry.apiConfigName ?? t("board:activity.unknownApiConfig")
						return (
							<article
								key={entry.id}
								data-testid={`board-activity-entry-${entry.id}`}
								title={`${entry.taskTitle.trim() || "Untitled task"} — ${new Date(entry.at).toLocaleString()}`}
								className="rounded-lg border border-vscode-panel-border bg-vscode-editor-background p-2 font-mono text-[11px] leading-relaxed shadow-sm">
								<span className="text-vscode-descriptionForeground">[{reference}]</span>{" "}
								<span className="text-vscode-descriptionForeground">
									[{mode} - {apiConfigName}]
								</span>{" "}
								<span
									className={cn(
										"font-semibold",
										entry.outcome === "passed"
											? "text-vscode-charts-green"
											: "text-vscode-errorForeground",
									)}>
									[{t(`board:activity.outcome.${entry.outcome}`)}]
								</span>{" "}
								<span className="text-vscode-foreground">
									{t(STAGE_LABEL_KEYS[entry.from])} {"->"} {t(STAGE_LABEL_KEYS[entry.to])}
								</span>
							</article>
						)
					})
				)}
			</div>
		</div>
	)
}

export default memo(BoardActivityColumn)
