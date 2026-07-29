import { memo, useState } from "react"
import { Check, ExternalLink, Play, Sparkles, Square, X } from "lucide-react"

import { formatBoardTaskNumber, type BoardStage, type BoardTask } from "@roo-code/types"

import { Button } from "@/components/ui/button"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@/lib/utils"
import { vscode } from "@/utils/vscode"

import { writeBoardTaskDrag } from "./boardDrag"

type PrimaryAction = {
	labelKey: string
	icon: typeof Play
	messageType: "refineBoardTask" | "approveBoardTask" | "startBoardTask" | "stopBoardTask" | "showTaskWithId"
	variant: "primary" | "secondary" | "destructive"
	requiresTitle: boolean
}

/**
 * The primary button walks a card through the pipeline, so it is derived from the
 * card's stage rather than from whether an execution task exists.
 */
const PRIMARY_ACTIONS: Record<BoardStage, PrimaryAction> = {
	backlog: {
		labelKey: "board:actions.refine",
		icon: Sparkles,
		messageType: "refineBoardTask",
		variant: "primary",
		requiresTitle: true,
	},
	scoped: {
		labelKey: "board:actions.approve",
		icon: Check,
		messageType: "approveBoardTask",
		variant: "primary",
		requiresTitle: true,
	},
	approved: {
		labelKey: "board:actions.start",
		icon: Play,
		messageType: "startBoardTask",
		variant: "primary",
		requiresTitle: true,
	},
	in_progress: {
		labelKey: "board:actions.stop",
		icon: Square,
		messageType: "stopBoardTask",
		variant: "destructive",
		requiresTitle: false,
	},
	done: {
		labelKey: "board:actions.open",
		icon: ExternalLink,
		messageType: "showTaskWithId",
		variant: "secondary",
		requiresTitle: false,
	},
}

const TaskBoardCard = ({ task }: { task: BoardTask }) => {
	const { t } = useAppTranslation()
	const [title, setTitle] = useState(task.title)
	const [description, setDescription] = useState(task.description ?? "")
	const COLLAPSED_DESCRIPTION_LENGTH = 180
	const [descriptionExpanded, setDescriptionExpanded] = useState(false)
	const hasLongDescription = description.length > COLLAPSED_DESCRIPTION_LENGTH
	const showExpandedDescription = !hasLongDescription || descriptionExpanded
	const [isDragging, setIsDragging] = useState(false)
	// Dragging the whole card would make the title/description impossible to select
	// with the mouse, so the card stops being draggable while a field has focus.
	// Focus lands before the drag gesture begins, so the card is already inert by
	// the time the pointer moves.
	const [isEditingInline, setIsEditingInline] = useState(false)
	const save = () => {
		setIsEditingInline(false)
		if (title !== task.title || description !== (task.description ?? ""))
			vscode.postMessage({ type: "updateBoardTask", taskId: task.id, boardTask: { title, description } })
	}
	const taskNumber = formatBoardTaskNumber(task.number)
	// The card's conversation, shown in the chat dock when the card is clicked. A
	// running or finished card means the execution chat; before that, the refinement
	// chat is the only conversation the card has. A card with neither has nothing to
	// open yet, and clicking it must not start one by accident.
	const chatTaskId = task.linkedHistoryTaskId ?? task.linkedRefinementTaskId
	const openChat = () => chatTaskId && vscode.postMessage({ type: "showTaskWithId", text: chatTaskId })
	const openChatFromCard = (event: React.MouseEvent) => {
		// The card's own controls own their clicks: editing a title, expanding the
		// description, or pressing Start must not also swap the dock's conversation.
		if (event.target instanceof Element && event.target.closest("input, textarea, button")) return
		openChat()
	}
	const primaryAction = PRIMARY_ACTIONS[task.stage]
	const PrimaryIcon = primaryAction.icon
	const primaryDisabled =
		(primaryAction.requiresTitle && !task.title.trim()) ||
		// A card can reach Done without ever having been run (moved by hand or by the LLM).
		(primaryAction.messageType === "showTaskWithId" && !task.linkedHistoryTaskId)
	return (
		<article
			data-testid={`board-task-item-${task.id}`}
			draggable={!isEditingInline}
			onDragStart={(event) => {
				writeBoardTaskDrag(event.dataTransfer, { taskId: task.id, stage: task.stage })
				setIsDragging(true)
			}}
			onDragEnd={() => setIsDragging(false)}
			onClick={openChatFromCard}
			className={cn(
				"rounded-lg border border-vscode-panel-border bg-vscode-editor-background p-3 shadow-sm",
				!isEditingInline && "cursor-grab active:cursor-grabbing",
				chatTaskId && "hover:border-vscode-focusBorder",
				isDragging && "opacity-50",
			)}>
			{taskNumber &&
				// The number doubles as the card's keyboard route to its chat, so opening a
				// conversation does not depend on clicking the card body.
				(chatTaskId ? (
					<button
						type="button"
						data-testid={`board-task-number-${task.id}`}
						aria-label={`Open ${taskNumber} chat`}
						onClick={openChat}
						className="mb-1 block cursor-pointer bg-transparent p-0 font-mono text-[10px] tracking-wider text-vscode-descriptionForeground hover:text-vscode-textLink-foreground">
						{taskNumber}
					</button>
				) : (
					<div
						data-testid={`board-task-number-${task.id}`}
						className="mb-1 font-mono text-[10px] tracking-wider text-vscode-descriptionForeground">
						{taskNumber}
					</div>
				))}
			<input
				value={title}
				placeholder="Untitled task"
				aria-label="Task title"
				onFocus={() => setIsEditingInline(true)}
				onChange={(event) => setTitle(event.target.value)}
				onBlur={save}
				className="w-full cursor-text bg-transparent text-sm font-medium text-vscode-editor-foreground outline-none placeholder:text-vscode-descriptionForeground"
			/>
			<textarea
				value={description}
				placeholder="Description"
				aria-label="Task description"
				onFocus={() => {
					setDescriptionExpanded(true)
					setIsEditingInline(true)
				}}
				onChange={(event) => setDescription(event.target.value)}
				onBlur={save}
				className={`mt-2 w-full cursor-text bg-transparent text-xs text-vscode-descriptionForeground outline-none ${
					showExpandedDescription ? "min-h-32 max-h-64 resize-y" : "h-16 resize-none overflow-y-hidden"
				}`}
			/>
			{hasLongDescription && (
				<Button
					variant="ghost"
					className="mt-1 h-6 px-0 text-xs text-vscode-textLink-foreground"
					onClick={() => setDescriptionExpanded((expanded) => !expanded)}>
					{showExpandedDescription ? "Show less" : "Show full description"}
				</Button>
			)}
			<div className="mt-2 flex justify-between">
				<Button
					variant={primaryAction.variant}
					className="h-7 px-2 text-xs"
					disabled={primaryDisabled}
					onClick={() =>
						vscode.postMessage(
							primaryAction.messageType === "showTaskWithId"
								? { type: "showTaskWithId", text: task.linkedHistoryTaskId }
								: { type: primaryAction.messageType, taskId: task.id },
						)
					}>
					<PrimaryIcon className="mr-1 size-3" />
					{t(primaryAction.labelKey)}
				</Button>
				<Button
					variant="ghost"
					className="size-7 p-0 text-vscode-errorForeground"
					aria-label="Close task"
					onClick={() => vscode.postMessage({ type: "deleteBoardTask", taskId: task.id })}>
					<X className="size-3" />
				</Button>
			</div>
		</article>
	)
}

export default memo(TaskBoardCard)
