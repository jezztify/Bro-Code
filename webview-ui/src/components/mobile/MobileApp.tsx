import { useEffect, useState } from "react"

import { vscode, ZOO_MOBILE_CONNECTION_EVENT, type ZooMobileConnectionEventDetail } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { IconButton } from "@src/components/common/IconButton"
import ChatView from "@src/components/chat/ChatView"

/**
 * Full-screen mobile shell rendered by `App.tsx` instead of the desktop tab
 * chrome (Settings/History/MCP/Marketplace) when `window.ZOO_MOBILE_MODE` is
 * set - see the mobile-server plan's Phase B. `ChatView` itself is reused
 * completely unmodified (same always-mounted/`isHidden` pattern as desktop).
 */
export function MobileApp() {
	const { t } = useAppTranslation()
	const [isReconnecting, setIsReconnecting] = useState(false)

	useEffect(() => {
		const handleConnectionEvent = (event: Event) => {
			const { status } = (event as CustomEvent<ZooMobileConnectionEventDetail>).detail
			setIsReconnecting(status === "reconnecting")
		}

		window.addEventListener(ZOO_MOBILE_CONNECTION_EVENT, handleConnectionEvent)
		return () => window.removeEventListener(ZOO_MOBILE_CONNECTION_EVENT, handleConnectionEvent)
	}, [])

	return (
		<div className="fixed inset-0 flex flex-col overflow-hidden">
			{isReconnecting && (
				<div className="shrink-0 bg-vscode-editorWarning-background px-3 py-1 text-center text-xs text-vscode-editorWarning-foreground">
					{t("chat:mobile.reconnecting")}
				</div>
			)}
			<div className="flex shrink-0 items-center justify-between border-b border-vscode-editorGroup-border px-3 py-2">
				<span className="font-semibold text-vscode-foreground">{t("chat:mobile.title")}</span>
				<IconButton
					icon="add"
					title={t("chat:mobile.newTask")}
					onClick={() => vscode.postMessage({ type: "clearTask" })}
				/>
			</div>
			<div className="min-h-0 flex-1">
				<ChatView isHidden={false} showAnnouncement={false} hideAnnouncement={() => {}} />
			</div>
		</div>
	)
}

export default MobileApp
