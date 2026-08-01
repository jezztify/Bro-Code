import { useEffect, useState } from "react"

import { ZOO_MOBILE_CONNECTION_EVENT, type ZooMobileConnectionEventDetail } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"

/**
 * The only mobile-specific chrome left in the app: a transient "reconnecting"
 * strip shown while the phone's WebSocket transport is down.
 *
 * Mobile used to render a dedicated chat-only shell instead of the desktop
 * `AppShell`, which meant a phone could reach the chat but never the board.
 * `App.tsx` now renders the same shell (rail + routed pane + chat dock) on both,
 * so this overlays the shell rather than sitting in its layout - it's absent
 * most of the time, and reserving a row for it would shift the whole app down
 * whenever the connection blipped.
 */
export function MobileConnectionBanner() {
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

	if (!isReconnecting) {
		return null
	}

	return (
		<div
			role="status"
			data-testid="mobile-connection-banner"
			className="fixed inset-x-0 top-0 z-50 bg-vscode-editorWarning-background px-3 py-1 text-center text-xs text-vscode-editorWarning-foreground">
			{t("chat:mobile.reconnecting")}
		</div>
	)
}

export default MobileConnectionBanner
