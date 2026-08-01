import { forwardRef, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronUp, Maximize2, Minimize2, Plus, X } from "lucide-react"

import type { HistoryItem } from "@roo-code/types"

import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"

import ChatView, { type ChatViewProps, type ChatViewRef } from "../chat/ChatView"

// How many recently-active tasks to surface as switcher chips. "Recently focused" is
// approximated as "recently active" (taskHistory's `ts` field, which every task-history write
// already bumps) rather than tracked as a separate frontend/backend concept - no new backend
// message or persisted state is needed for this, per the shell redesign's decision that the
// dock's task-switcher stays purely a frontend/layout affordance over data that already exists.
const MAX_RECENT_CHIPS = 6

// Bounds for a dragged dock height. The dock must stay tall enough to hold its
// toolbar and the chat input, and must always leave the routed pane above it a
// usable strip - dragging cannot be allowed to push the board off screen.
const MIN_DOCK_HEIGHT = 160
const MIN_PANE_HEIGHT = 120
// How much one arrow-key press moves the top edge, for resizing without a mouse.
const RESIZE_KEY_STEP = 24

const clampDockHeight = (height: number) =>
	Math.max(MIN_DOCK_HEIGHT, Math.min(height, Math.max(MIN_DOCK_HEIGHT, window.innerHeight - MIN_PANE_HEIGHT)))

type ChatDockProps = Pick<ChatViewProps, "showAnnouncement" | "hideAnnouncement"> & {
	/** The chat tab has no routed pane, so the dock uses the available content height. */
	expanded?: boolean
	/**
	 * The routed pane is hidden and the dock fills the content column. Owned by the
	 * shell rather than the dock, because opening a task from the board maximizes the
	 * dock without anyone pressing this dock's own button.
	 */
	maximized?: boolean
	/** Called when the user maximizes or restores the dock alongside a routed pane. */
	onMaximizedChange?: (maximized: boolean) => void
}

const ChatDock = forwardRef<ChatViewRef, ChatDockProps>(
	({ expanded = false, maximized = false, showAnnouncement, hideAnnouncement, onMaximizedChange }, ref) => {
		const { t } = useAppTranslation()
		const { taskHistory, currentTaskItem, cwd } = useExtensionState()
		const [closedTaskIds, setClosedTaskIds] = useState<Set<string>>(() => new Set())
		const [isTaskListOpen, setIsTaskListOpen] = useState(false)
		const [isCollapsed, setIsCollapsed] = useState(false)
		// null until the user drags the top edge, so an untouched dock keeps its
		// viewport-relative default height instead of being pinned to pixels.
		const [dockHeight, setDockHeight] = useState<number | null>(null)
		const taskListRef = useRef<HTMLDivElement>(null)
		const dockRef = useRef<HTMLDivElement>(null)
		const isExpanded = expanded || maximized
		const canCollapse = !isExpanded
		const isChatHidden = canCollapse && isCollapsed
		const toggleMaximized = () => onMaximizedChange?.(!maximized)
		// Only the standard docked height is the user's to set: expanded and maximized are
		// told to fill the column, and a collapsed dock is a title bar.
		const isResizable = !isExpanded && !isCollapsed
		const currentHeight = () => dockHeight ?? dockRef.current?.getBoundingClientRect().height ?? MIN_DOCK_HEIGHT

		const startResize = (event: React.MouseEvent) => {
			// Without this the drag selects the surrounding text instead of resizing.
			event.preventDefault()
			const startY = event.clientY
			const startHeight = currentHeight()
			// Dragging the top edge upwards makes the dock taller, hence the inverted delta.
			const handleMouseMove = (move: MouseEvent) =>
				setDockHeight(clampDockHeight(startHeight + (startY - move.clientY)))
			const handleMouseUp = () => {
				document.removeEventListener("mousemove", handleMouseMove)
				document.removeEventListener("mouseup", handleMouseUp)
			}
			document.addEventListener("mousemove", handleMouseMove)
			document.addEventListener("mouseup", handleMouseUp)
		}

		const handleResizeKeyDown = (event: React.KeyboardEvent) => {
			const step = event.key === "ArrowUp" ? RESIZE_KEY_STEP : event.key === "ArrowDown" ? -RESIZE_KEY_STEP : 0
			if (!step) {
				return
			}
			event.preventDefault()
			setDockHeight(clampDockHeight(currentHeight() + step))
		}

		// A window that shrinks below the dragged height would otherwise squeeze the routed
		// pane out of the column entirely.
		useEffect(() => {
			const handleWindowResize = () =>
				setDockHeight((height) => (height === null ? null : clampDockHeight(height)))
			window.addEventListener("resize", handleWindowResize)
			return () => window.removeEventListener("resize", handleWindowResize)
		}, [])

		const recentTasks = useMemo(() => {
			return [...taskHistory]
				.filter((item) => item.workspace === cwd)
				.filter((item) => !closedTaskIds.has(item.id))
				.sort((a, b) => b.ts - a.ts)
				.slice(0, MAX_RECENT_CHIPS)
		}, [closedTaskIds, cwd, taskHistory])

		const handleCloseTask = (taskId: string) => {
			setClosedTaskIds((ids) => new Set(ids).add(taskId))
		}

		const handleSelectTask = (taskId: string) => {
			if (taskId !== currentTaskItem?.id) {
				vscode.postMessage({ type: "showTaskWithId", text: taskId })
			}
			setIsTaskListOpen(false)
		}

		useEffect(() => {
			if (!isTaskListOpen) {
				return
			}

			const handlePointerDown = (event: MouseEvent) => {
				if (event.target instanceof Node && !taskListRef.current?.contains(event.target)) {
					setIsTaskListOpen(false)
				}
			}
			const handleKeyDown = (event: KeyboardEvent) => {
				if (event.key === "Escape") {
					setIsTaskListOpen(false)
				}
			}

			document.addEventListener("mousedown", handlePointerDown)
			document.addEventListener("keydown", handleKeyDown)
			return () => {
				document.removeEventListener("mousedown", handlePointerDown)
				document.removeEventListener("keydown", handleKeyDown)
			}
		}, [isTaskListOpen])

		return (
			<div
				ref={dockRef}
				data-testid="chat-dock"
				className={
					isExpanded
						? "flex-1 min-h-0 flex flex-col border-t border-vscode-panel-border bg-vscode-editor-background"
						: isCollapsed
							? "flex h-11 shrink-0 flex-col border-t border-vscode-panel-border bg-vscode-editor-background"
							: dockHeight !== null
								? "flex shrink-0 flex-col border-t border-vscode-panel-border bg-vscode-editor-background"
								: // The 400px floor is a desktop floor: on a phone-width viewport it
									// would leave the routed pane above a uselessly short strip, so the
									// dock only claims that much once there's a window wide enough to be
									// a desktop.
									"flex h-[45vh] min-h-[240px] max-h-[560px] shrink-0 flex-col border-t border-vscode-panel-border bg-vscode-editor-background sm:min-h-[400px]"
				}
				style={isResizable && dockHeight !== null ? { height: dockHeight } : undefined}>
				{isResizable && (
					<div
						role="separator"
						aria-orientation="horizontal"
						aria-label={t("shell:dock.resizeChat")}
						data-testid="chat-dock-resize-handle"
						tabIndex={0}
						className="h-1.5 shrink-0 cursor-row-resize hover:bg-vscode-focusBorder focus-visible:bg-vscode-focusBorder focus-visible:outline-none"
						onMouseDown={startResize}
						onKeyDown={handleResizeKeyDown}
					/>
				)}
				{(recentTasks.length > 0 || canCollapse || !expanded) && (
					<div className="flex items-center border-b border-vscode-panel-border px-2 py-1.5 shrink-0">
						<button
							type="button"
							data-testid="chat-dock-new-chat"
							aria-label={t("shell:dock.newChat")}
							className="flex size-7 shrink-0 items-center justify-center rounded-sm text-vscode-descriptionForeground cursor-pointer hover:bg-vscode-toolbar-hoverBackground hover:text-vscode-foreground"
							onClick={() => vscode.postMessage({ type: "unfocusTask" })}>
							<Plus className="size-4" />
						</button>
						{recentTasks.length > 0 && (
							<div ref={taskListRef} className="relative min-w-0">
								<button
									type="button"
									data-testid="chat-dock-task-list-trigger"
									aria-label={t("shell:dock.chipsLabel")}
									aria-expanded={isTaskListOpen}
									className="flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-vscode-descriptionForeground cursor-pointer hover:bg-vscode-toolbar-hoverBackground hover:text-vscode-foreground"
									onClick={() => setIsTaskListOpen((open) => !open)}>
									<span className="truncate">
										{t("shell:dock.taskList", { count: recentTasks.length })}
									</span>
									<ChevronDown className="size-3 shrink-0" />
								</button>
								{isTaskListOpen && (
									<div
										data-testid="chat-dock-task-list"
										className="absolute left-2 top-full z-50 mt-1 w-[min(320px,calc(100vw-2rem))] max-h-72 overflow-y-auto rounded-xs border border-vscode-focusBorder bg-vscode-dropdown-background p-1 shadow-xs">
										<div aria-label={t("shell:dock.chipsLabel")} role="listbox">
											{recentTasks.map((item) => (
												<TaskChatListItem
													key={item.id}
													item={item}
													isActive={item.id === currentTaskItem?.id}
													onClose={handleCloseTask}
													onSelect={handleSelectTask}
												/>
											))}
										</div>
									</div>
								)}
							</div>
						)}
						{canCollapse && (
							<button
								type="button"
								data-testid="chat-dock-toggle"
								aria-label={t(isCollapsed ? "shell:dock.expandChat" : "shell:dock.collapseChat")}
								aria-expanded={!isCollapsed}
								className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-sm text-vscode-descriptionForeground cursor-pointer hover:bg-vscode-toolbar-hoverBackground hover:text-vscode-foreground"
								onClick={() => setIsCollapsed((collapsed) => !collapsed)}>
								{isCollapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
							</button>
						)}
						{!expanded && (
							<button
								type="button"
								data-testid="chat-dock-maximize"
								aria-label={t(maximized ? "shell:dock.restoreChat" : "shell:dock.maximizeChat")}
								className="flex size-7 shrink-0 items-center justify-center rounded-sm text-vscode-descriptionForeground cursor-pointer hover:bg-vscode-toolbar-hoverBackground hover:text-vscode-foreground"
								onClick={toggleMaximized}>
								{maximized ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
							</button>
						)}
					</div>
				)}
				<ChatView
					ref={ref}
					variant="docked"
					isHidden={isChatHidden}
					showAnnouncement={showAnnouncement}
					hideAnnouncement={hideAnnouncement}
				/>
			</div>
		)
	},
)
ChatDock.displayName = "ChatDock"

export default ChatDock

interface TaskChatListItemProps {
	item: HistoryItem
	isActive: boolean
	onClose: (taskId: string) => void
	onSelect: (taskId: string) => void
}

const TaskChatListItem = ({ item, isActive, onClose, onSelect }: TaskChatListItemProps) => {
	const { t } = useAppTranslation()

	return (
		<div
			role="option"
			aria-selected={isActive}
			className="flex items-center gap-1 rounded-sm px-1 py-0.5 text-sm text-vscode-dropdown-foreground hover:bg-vscode-list-hoverBackground">
			<button
				type="button"
				data-testid={`task-chip-${item.id}`}
				aria-current={isActive || undefined}
				className="min-w-0 flex-1 truncate cursor-pointer px-1.5 py-1 text-left"
				onClick={() => onSelect(item.id)}>
				{item.task}
			</button>
			<button
				type="button"
				data-testid={`task-chip-close-${item.id}`}
				aria-label={t("shell:dock.closeTask", { task: item.task })}
				className="flex size-6 shrink-0 items-center justify-center rounded-sm cursor-pointer hover:bg-vscode-toolbar-hoverBackground"
				onClick={() => onClose(item.id)}>
				<X className="size-3" />
			</button>
		</div>
	)
}
