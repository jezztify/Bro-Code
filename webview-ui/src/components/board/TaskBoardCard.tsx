import { memo, useState } from "react"
import { Check, ClipboardCheck, ExternalLink, MessageCircleQuestion, Play, Sparkles, Square, X } from "lucide-react"

import { formatBoardTaskNumber, type BoardStage, type BoardTask } from "@roo-code/types"

import { Button } from "@/components/ui/button"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@/lib/utils"
import { vscode } from "@/utils/vscode"

import { writeBoardTaskDrag } from "./boardDrag"

type PrimaryAction = {
	labelKey: string
	icon: typeof Play
	messageType:
		| "refineBoardTask"
		| "approveBoardTask"
		| "startBoardTask"
		| "validateBoardTask"
		| "stopBoardTask"
		| "stopBoardRefinement"
		| "stopBoardValidation"
		| "showTaskWithId"
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
	qa_validation: {
		labelKey: "board:actions.validate",
		icon: ClipboardCheck,
		messageType: "validateBoardTask",
		variant: "primary",
		requiresTitle: true,
	},
	done: {
		labelKey: "board:actions.open",
		icon: ExternalLink,
		messageType: "showTaskWithId",
		variant: "secondary",
		requiresTitle: false,
	},
}

/**
 * What a column's own button turns into while the run it started is still going, so
 * the card offers to call that run off rather than a second press that would only
 * reopen the conversation. In Progress is not here: its button is already Stop, and
 * it is the one column whose idle state means something else (see below).
 *
 * Stays enabled on an untitled card — a run that is going has to be cancellable
 * whatever the card says.
 */
const STOP_ACTIONS = {
	backlog: "stopBoardRefinement",
	qa_validation: "stopBoardValidation",
} as const

const stopAction = (stage: keyof typeof STOP_ACTIONS): PrimaryAction => ({
	labelKey: "board:actions.stop",
	icon: Square,
	messageType: STOP_ACTIONS[stage],
	variant: "destructive",
	requiresTitle: false,
})

const TaskBoardCard = ({
	task,
	isRunning = false,
	isRefining = false,
	isValidating = false,
	isAwaitingInput = false,
}: {
	task: BoardTask
	/** Whether the card's execution run is still working in the extension host. */
	isRunning?: boolean
	/** Whether the card's refinement run is still working in the extension host. */
	isRefining?: boolean
	/** Whether the card's validation run is still working in the extension host. */
	isValidating?: boolean
	/**
	 * Whether one of the card's runs has stopped to ask the user something. Such a run
	 * counts as live, so nothing in the pipeline will move it along — only an answer
	 * will, which is why the card has to say so rather than looking merely busy.
	 */
	isAwaitingInput?: boolean
}) => {
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
	// The card's conversation, shown in the chat dock when the card is clicked. The
	// card's latest conversation wins: validation once it has been checked, otherwise
	// the execution run, and before that the refinement chat is the only conversation
	// the card has. A card with none has nothing to open yet, and clicking it must not
	// start one by accident.
	const chatTaskId = task.linkedValidationTaskId ?? task.linkedHistoryTaskId ?? task.linkedRefinementTaskId
	const openChat = () => chatTaskId && vscode.postMessage({ type: "showTaskWithId", text: chatTaskId })
	const openChatFromCard = (event: React.MouseEvent) => {
		// The card's own controls own their clicks: editing a title, expanding the
		// description, or pressing Start must not also swap the dock's conversation.
		if (event.target instanceof Element && event.target.closest("input, textarea, button")) return
		openChat()
	}
	// A card stays in its column until its run reports completion, but the run itself
	// only lives in the extension host: cancelling it from the chat view, a failed
	// stream, or reloading the window all leave the card behind with nothing running.
	// Stop is only meaningful while there is something to cancel, so every column reads
	// the working set rather than the card's link.
	const stop =
		(task.stage === "backlog" && isRefining) || (task.stage === "qa_validation" && isValidating)
			? stopAction(task.stage)
			: undefined
	// In Progress is the other way round: the card arrives there already offering Stop,
	// so it is an idle run that changes the button - to Start, which reopens the linked
	// conversation and tells it to carry on rather than throwing the run away and
	// beginning the card again.
	const primaryAction =
		stop ?? (task.stage === "in_progress" && !isRunning ? PRIMARY_ACTIONS.approved : PRIMARY_ACTIONS[task.stage])
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
			{isAwaitingInput && chatTaskId && (
				// The board's own explanation for why nothing is moving. Clicking it opens
				// the conversation holding the question, which is where it gets answered.
				<button
					type="button"
					data-testid={`board-task-awaiting-${task.id}`}
					onClick={openChat}
					className="mt-2 flex w-full cursor-pointer items-center gap-1.5 rounded border border-vscode-inputValidation-warningBorder bg-vscode-inputValidation-warningBackground px-2 py-1 text-left text-xs text-vscode-inputValidation-warningForeground">
					<MessageCircleQuestion className="size-3 shrink-0" />
					{t("board:card.awaitingInput")}
				</button>
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
