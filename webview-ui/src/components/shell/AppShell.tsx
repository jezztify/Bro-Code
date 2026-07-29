import { forwardRef, type ReactNode } from "react"

import type { ChatViewProps, ChatViewRef } from "../chat/ChatView"

import Rail, { type RailTab } from "./Rail"
import ChatDock from "./ChatDock"

interface AppShellProps {
	activeTab: RailTab | undefined
	onNavigate: (tab: RailTab) => void
	/**
	 * Whether the dock covers the routed pane. App owns it because opening a task
	 * from the board maximizes the dock, not just the dock's own button.
	 */
	isChatMaximized: boolean
	onChatMaximizedChange: (maximized: boolean) => void
	showAnnouncement: ChatViewProps["showAnnouncement"]
	hideAnnouncement: ChatViewProps["hideAnnouncement"]
	/** The routed pane (Board / Settings / Marketplace), or null when no pane is selected. */
	children: ReactNode
}

/**
 * Top-level layout shared by every non-mobile, non-welcome render of the
 * extension: a left icon rail, a routed content pane, and a persistent chat dock docked to the
 * bottom of the content column. See docs/webview-shell-redesign.md.
 */
const AppShell = forwardRef<ChatViewRef, AppShellProps>(
	(
		{ activeTab, onNavigate, isChatMaximized, onChatMaximizedChange, showAnnouncement, hideAnnouncement, children },
		chatDockRef,
	) => {
		return (
			<div data-testid="app-shell" className="fixed inset-0 flex">
				<Rail activeTab={activeTab} onNavigate={onNavigate} />
				{/* justify-end keeps ChatDock pinned to the bottom even when no pane (children) is
				routed - e.g. the "chat" tab, where the pane is intentionally empty so the dock gets
				the most room. When a pane is routed it fills the remaining space via flex-1 (Tab's
				"shell" variant), which already pushes the dock down, so justify-end is a no-op then. */}
				<div className="flex-1 min-w-0 min-h-0 flex flex-col justify-end">
					<div className={isChatMaximized ? "hidden" : "contents"}>{children}</div>
					<ChatDock
						ref={chatDockRef}
						expanded={activeTab === undefined}
						maximized={isChatMaximized}
						onMaximizedChange={onChatMaximizedChange}
						showAnnouncement={showAnnouncement}
						hideAnnouncement={hideAnnouncement}
					/>
				</div>
			</div>
		)
	},
)
AppShell.displayName = "AppShell"

export default AppShell
