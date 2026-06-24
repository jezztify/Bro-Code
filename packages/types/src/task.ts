import { z } from "zod"

import { BroCodeEventName } from "./events.js"
import type { BroCodeSettings } from "./global-settings.js"
import type { ClineMessage, QueuedMessage, TokenUsage } from "./message.js"
import type { ToolUsage, ToolName } from "./tool.js"
import type { TodoItem } from "./todo.js"

/**
 * TaskProviderLike
 */

export interface TaskProviderLike {
	// Tasks
	getCurrentTask(): TaskLike | undefined
	getRecentTasks(): string[]
	createTask(
		text?: string,
		images?: string[],
		parentTask?: TaskLike,
		options?: CreateTaskOptions,
		configuration?: BroCodeSettings,
	): Promise<TaskLike>
	cancelTask(): Promise<void>
	clearTask(): Promise<void>
	resumeTask(taskId: string): void

	// Modes
	getModes(): Promise<{ slug: string; name: string }[]>
	getMode(): Promise<string>
	setMode(mode: string): Promise<void>

	// Provider Profiles
	getProviderProfiles(): Promise<{ name: string; provider?: string }[]>
	getProviderProfile(): Promise<string>
	setProviderProfile(providerProfile: string): Promise<void>

	readonly cwd: string

	// Event Emitter
	on<K extends keyof TaskProviderEvents>(
		event: K,
		listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
	): this

	off<K extends keyof TaskProviderEvents>(
		event: K,
		listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
	): this

	// @TODO: Find a better way to do this.
	postStateToWebview(): Promise<void>
}

export type TaskProviderEvents = {
	[BroCodeEventName.TaskCreated]: [task: TaskLike]
	[BroCodeEventName.TaskStarted]: [taskId: string]
	[BroCodeEventName.TaskCompleted]: [taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage]
	[BroCodeEventName.TaskAborted]: [taskId: string]
	[BroCodeEventName.TaskFocused]: [taskId: string]
	[BroCodeEventName.TaskUnfocused]: [taskId: string]
	[BroCodeEventName.TaskActive]: [taskId: string]
	[BroCodeEventName.TaskInteractive]: [taskId: string]
	[BroCodeEventName.TaskResumable]: [taskId: string]
	[BroCodeEventName.TaskIdle]: [taskId: string]

	[BroCodeEventName.TaskPaused]: [taskId: string]
	[BroCodeEventName.TaskUnpaused]: [taskId: string]
	[BroCodeEventName.TaskSpawned]: [taskId: string]
	[BroCodeEventName.TaskDelegated]: [parentTaskId: string, childTaskId: string]
	[BroCodeEventName.TaskDelegationCompleted]: [parentTaskId: string, childTaskId: string, summary: string]
	[BroCodeEventName.TaskDelegationResumed]: [parentTaskId: string, childTaskId: string]

	[BroCodeEventName.TaskUserMessage]: [taskId: string]

	[BroCodeEventName.TaskTokenUsageUpdated]: [taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage]

	[BroCodeEventName.ModeChanged]: [mode: string]
	[BroCodeEventName.ProviderProfileChanged]: [config: { name: string; provider?: string }]
}

/**
 * TaskLike
 */

export interface CreateTaskOptions {
	taskId?: string
	enableCheckpoints?: boolean
	consecutiveMistakeLimit?: number
	experiments?: Record<string, boolean>
	initialTodos?: TodoItem[]
	/** Initial status for the task's history item (e.g., "active" for child tasks) */
	initialStatus?: "active" | "delegated" | "completed"
	/** Whether to start the task loop immediately (default: true).
	 *  When false, the caller must invoke `task.start()` manually. */
	startTask?: boolean
}

export enum TaskStatus {
	Running = "running",
	Interactive = "interactive",
	Resumable = "resumable",
	Idle = "idle",
	None = "none",
}

export const taskMetadataSchema = z.object({
	task: z.string().optional(),
	images: z.array(z.string()).optional(),
})

export type TaskMetadata = z.infer<typeof taskMetadataSchema>

export interface TaskLike {
	readonly taskId: string
	readonly rootTaskId?: string
	readonly parentTaskId?: string
	readonly childTaskId?: string
	readonly metadata: TaskMetadata
	readonly taskStatus: TaskStatus
	readonly taskAsk: ClineMessage | undefined
	readonly queuedMessages: QueuedMessage[]
	readonly tokenUsage: TokenUsage | undefined

	on<K extends keyof TaskEvents>(event: K, listener: (...args: TaskEvents[K]) => void | Promise<void>): this
	off<K extends keyof TaskEvents>(event: K, listener: (...args: TaskEvents[K]) => void | Promise<void>): this

	approveAsk(options?: { text?: string; images?: string[] }): void
	denyAsk(options?: { text?: string; images?: string[] }): void
	submitUserMessage(text: string, images?: string[], mode?: string, providerProfile?: string): Promise<void>
	abortTask(): void
}

export type TaskEvents = {
	// Task Lifecycle
	[BroCodeEventName.TaskStarted]: []
	[BroCodeEventName.TaskCompleted]: [taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage]
	[BroCodeEventName.TaskAborted]: []
	[BroCodeEventName.TaskFocused]: []
	[BroCodeEventName.TaskUnfocused]: []
	[BroCodeEventName.TaskActive]: [taskId: string]
	[BroCodeEventName.TaskInteractive]: [taskId: string]
	[BroCodeEventName.TaskResumable]: [taskId: string]
	[BroCodeEventName.TaskIdle]: [taskId: string]

	// Subtask Lifecycle
	[BroCodeEventName.TaskPaused]: [taskId: string]
	[BroCodeEventName.TaskUnpaused]: [taskId: string]
	[BroCodeEventName.TaskSpawned]: [taskId: string]

	// Task Execution
	[BroCodeEventName.Message]: [{ action: "created" | "updated"; message: ClineMessage }]
	[BroCodeEventName.TaskModeSwitched]: [taskId: string, mode: string]
	[BroCodeEventName.TaskAskResponded]: []
	[BroCodeEventName.TaskUserMessage]: [taskId: string]
	[BroCodeEventName.QueuedMessagesUpdated]: [taskId: string, messages: QueuedMessage[]]

	// Task Analytics
	[BroCodeEventName.TaskToolFailed]: [taskId: string, tool: ToolName, error: string]
	[BroCodeEventName.TaskTokenUsageUpdated]: [taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage]
}
