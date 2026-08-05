import { memo, useMemo } from "react"
import { Bot, Play, Square } from "lucide-react"

import type { BoardManager, BoardTask, ModeConfig, ProviderSettingsEntry } from "@roo-code/types"
import { BOARD_ACTIVE_STAGES, BOARD_ACTIVE_TASK_LIMIT } from "@roo-code/types"
import { getAllModes } from "@roo/modes"

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"

/** Distinguishes "the column decides" from a mode the manager was actually given. */
const USE_COLUMN_MODE = "__use_column_mode__"
/** Distinguishes "whichever profile is selected" from one the manager was actually given. */
const USE_CURRENT_API_CONFIG = "__use_current_api_config__"

/**
 * The board's autopilot, as a card of its own in the activity column: it holds no
 * tasks and belongs to no stage, so it is not a {@link BoardColumn} — it watches
 * them all.
 *
 * Deliberately only three controls. Everything about *what* it does next is a rule
 * rather than a setting (see `BoardManager` in the extension host), so the only
 * decisions left to make here are what it runs cards under, and whether it is on.
 */
const BoardManagerCard = ({
	workspaceId,
	manager,
	tasks,
	customModes,
	apiConfigs,
}: {
	workspaceId: string
	manager?: BoardManager
	/** This workspace's cards, for the count of what is being worked on right now. */
	tasks: readonly BoardTask[]
	customModes: ModeConfig[]
	apiConfigs: ProviderSettingsEntry[]
}) => {
	const { t } = useAppTranslation()
	const enabled = manager?.enabled ?? false
	const modes = useMemo(() => {
		const availableModes = getAllModes(customModes)
		// The manager can outlive the mode it was pointed at, so a deleted one stays
		// visible rather than silently reading as "use the column's mode".
		return manager?.mode && !availableModes.some((available) => available.slug === manager.mode)
			? [{ slug: manager.mode, name: `Unavailable: ${manager.mode}` }, ...availableModes]
			: availableModes
	}, [customModes, manager?.mode])
	const activeCount = useMemo(
		() => tasks.filter((task) => (BOARD_ACTIVE_STAGES as readonly string[]).includes(task.stage)).length,
		[tasks],
	)
	const set = (boardManager: { enabled?: boolean; mode?: string | null; apiConfigName?: string | null }) =>
		vscode.postMessage({ type: "setBoardManager", workspaceId, boardManager })

	return (
		<div
			data-testid="board-manager-card"
			className="flex shrink-0 flex-col gap-2 rounded-xl border border-vscode-panel-border bg-vscode-sideBar-background px-3 py-3">
			<div className="flex items-center justify-between gap-2">
				<h4 className="m-0 flex items-center gap-2 text-sm font-semibold text-vscode-foreground">
					<Bot className="size-4 shrink-0" />
					{t("board:manager.title")}
				</h4>
				<span
					data-testid="board-manager-status"
					className={
						enabled ? "text-xs text-vscode-charts-green" : "text-xs text-vscode-descriptionForeground"
					}>
					{t(enabled ? "board:manager.running" : "board:manager.stopped")}
				</span>
			</div>
			<p className="m-0 text-xs text-vscode-descriptionForeground">{t("board:manager.description")}</p>
			<Select
				value={manager?.mode ?? USE_COLUMN_MODE}
				onValueChange={(selected) => set({ mode: selected === USE_COLUMN_MODE ? null : selected })}>
				<SelectTrigger className="h-6 w-full text-xs" aria-label={t("board:manager.modeLabel")}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={USE_COLUMN_MODE}>{t("board:manager.useColumnMode")}</SelectItem>
					{modes.map((available) => (
						<SelectItem key={available.slug} value={available.slug}>
							{available.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<Select
				value={manager?.apiConfigName ?? USE_CURRENT_API_CONFIG}
				onValueChange={(selected) =>
					set({ apiConfigName: selected === USE_CURRENT_API_CONFIG ? null : selected })
				}>
				<SelectTrigger className="h-6 w-full text-xs" aria-label={t("board:manager.apiConfigLabel")}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={USE_CURRENT_API_CONFIG}>{t("board:manager.useCurrentApiConfig")}</SelectItem>
					{apiConfigs.map((config) => (
						<SelectItem key={config.id ?? config.name} value={config.name}>
							{config.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<Button
				variant={enabled ? "destructive" : "primary"}
				className="h-7 w-full text-xs"
				onClick={() => set({ enabled: !enabled })}>
				{enabled ? <Square className="mr-1 size-3" /> : <Play className="mr-1 size-3" />}
				{t(enabled ? "board:manager.stop" : "board:manager.start")}
			</Button>
			<p className="m-0 text-[11px] text-vscode-descriptionForeground">
				{t("board:manager.inFlight", { active: activeCount, limit: BOARD_ACTIVE_TASK_LIMIT })}
			</p>
		</div>
	)
}

export default memo(BoardManagerCard)
