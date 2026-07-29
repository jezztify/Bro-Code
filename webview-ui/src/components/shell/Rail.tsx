import { LayoutGrid, Settings, Store } from "lucide-react"

import { cn } from "@/lib/utils"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { StandardTooltip } from "@/components/ui"

export type RailTab = "board" | "settings" | "marketplace"

interface RailProps {
	activeTab: RailTab | undefined
	onNavigate: (tab: RailTab) => void
}

const Rail = ({ activeTab, onNavigate }: RailProps) => {
	const { t } = useAppTranslation()

	const entries: { tab: RailTab; icon: typeof LayoutGrid; labelKey: string; testId: string }[] = [
		{ tab: "board", icon: LayoutGrid, labelKey: "shell:rail.tasks", testId: "rail-board-button" },
		{ tab: "settings", icon: Settings, labelKey: "shell:rail.settings", testId: "rail-settings-button" },
		{ tab: "marketplace", icon: Store, labelKey: "shell:rail.marketplace", testId: "rail-marketplace-button" },
	]

	return (
		<nav
			data-testid="app-shell-rail"
			className="w-11 shrink-0 flex flex-col items-center gap-1 py-2 bg-vscode-sideBar-background border-r border-vscode-panel-border">
			{entries.map(({ tab, icon: Icon, labelKey, testId }) => {
				const isActive = activeTab === tab
				return (
					<StandardTooltip key={tab} content={t(labelKey)} side="right">
						<button
							type="button"
							data-testid={testId}
							aria-label={t(labelKey)}
							aria-current={isActive || undefined}
							className={cn(
								"flex items-center justify-center size-9 rounded-md transition-colors cursor-pointer",
								isActive
									? "bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground"
									: "text-vscode-foreground/70 hover:text-vscode-foreground hover:bg-vscode-toolbar-hoverBackground",
							)}
							onClick={() => onNavigate(tab)}>
							<Icon className="size-[18px]" />
						</button>
					</StandardTooltip>
				)
			})}
		</nav>
	)
}

export default Rail
