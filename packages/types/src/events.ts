import { z } from "zod"

import { clineMessageSchema, queuedMessageSchema, tokenUsageSchema } from "./message.js"
import { modelInfoSchema } from "./model.js"
import { toolNamesSchema, toolUsageSchema } from "./tool.js"

/**
 * BroCodeEventName
 */

export enum BroCodeEventName {
	// Task Provider Lifecycle
	TaskCreated = "taskCreated",

	// Task Lifecycle
	TaskStarted = "taskStarted",
	TaskCompleted = "taskCompleted",
	TaskAborted = "taskAborted",
	TaskFocused = "taskFocused",
	TaskUnfocused = "taskUnfocused",
	TaskActive = "taskActive",
	TaskInteractive = "taskInteractive",
	TaskResumable = "taskResumable",
	TaskIdle = "taskIdle",

	// Subtask Lifecycle
	TaskPaused = "taskPaused",
	TaskUnpaused = "taskUnpaused",
	TaskSpawned = "taskSpawned",
	TaskDelegated = "taskDelegated",
	TaskDelegationCompleted = "taskDelegationCompleted",
	TaskDelegationResumed = "taskDelegationResumed",

	// Task Execution
	Message = "message",
	TaskModeSwitched = "taskModeSwitched",
	TaskAskResponded = "taskAskResponded",
	TaskUserMessage = "taskUserMessage",
	QueuedMessagesUpdated = "queuedMessagesUpdated",

	// Task Analytics
	TaskTokenUsageUpdated = "taskTokenUsageUpdated",
	TaskToolFailed = "taskToolFailed",

	// Configuration Changes
	ModeChanged = "modeChanged",
	ProviderProfileChanged = "providerProfileChanged",

	// Query Responses
	CommandsResponse = "commandsResponse",
	ModesResponse = "modesResponse",
	ModelsResponse = "modelsResponse",
}

/**
 * BroCodeEvents
 */

export const broCodeEventsSchema = z.object({
	[BroCodeEventName.TaskCreated]: z.tuple([z.string()]),

	[BroCodeEventName.TaskStarted]: z.tuple([z.string()]),
	[BroCodeEventName.TaskCompleted]: z.tuple([
		z.string(),
		tokenUsageSchema,
		toolUsageSchema,
		z.object({
			isSubtask: z.boolean(),
		}),
	]),
	[BroCodeEventName.TaskAborted]: z.tuple([z.string()]),
	[BroCodeEventName.TaskFocused]: z.tuple([z.string()]),
	[BroCodeEventName.TaskUnfocused]: z.tuple([z.string()]),
	[BroCodeEventName.TaskActive]: z.tuple([z.string()]),
	[BroCodeEventName.TaskInteractive]: z.tuple([z.string()]),
	[BroCodeEventName.TaskResumable]: z.tuple([z.string()]),
	[BroCodeEventName.TaskIdle]: z.tuple([z.string()]),

	[BroCodeEventName.TaskPaused]: z.tuple([z.string()]),
	[BroCodeEventName.TaskUnpaused]: z.tuple([z.string()]),
	[BroCodeEventName.TaskSpawned]: z.tuple([z.string(), z.string()]),
	[BroCodeEventName.TaskDelegated]: z.tuple([
		z.string(), // parentTaskId
		z.string(), // childTaskId
	]),
	[BroCodeEventName.TaskDelegationCompleted]: z.tuple([
		z.string(), // parentTaskId
		z.string(), // childTaskId
		z.string(), // completionResultSummary
	]),
	[BroCodeEventName.TaskDelegationResumed]: z.tuple([
		z.string(), // parentTaskId
		z.string(), // childTaskId
	]),

	[BroCodeEventName.Message]: z.tuple([
		z.object({
			taskId: z.string(),
			action: z.union([z.literal("created"), z.literal("updated")]),
			message: clineMessageSchema,
		}),
	]),
	[BroCodeEventName.TaskModeSwitched]: z.tuple([z.string(), z.string()]),
	[BroCodeEventName.TaskAskResponded]: z.tuple([z.string()]),
	[BroCodeEventName.TaskUserMessage]: z.tuple([z.string()]),
	[BroCodeEventName.QueuedMessagesUpdated]: z.tuple([z.string(), z.array(queuedMessageSchema)]),

	[BroCodeEventName.TaskToolFailed]: z.tuple([z.string(), toolNamesSchema, z.string()]),
	[BroCodeEventName.TaskTokenUsageUpdated]: z.tuple([z.string(), tokenUsageSchema, toolUsageSchema]),

	[BroCodeEventName.ModeChanged]: z.tuple([z.string()]),
	[BroCodeEventName.ProviderProfileChanged]: z.tuple([z.object({ name: z.string(), provider: z.string() })]),

	[BroCodeEventName.CommandsResponse]: z.tuple([
		z.array(
			z.object({
				name: z.string(),
				source: z.enum(["global", "project", "built-in"]),
				filePath: z.string().optional(),
				description: z.string().optional(),
				argumentHint: z.string().optional(),
			}),
		),
	]),
	[BroCodeEventName.ModesResponse]: z.tuple([z.array(z.object({ slug: z.string(), name: z.string() }))]),
	[BroCodeEventName.ModelsResponse]: z.tuple([z.record(z.string(), modelInfoSchema)]),
})

export type BroCodeEvents = z.infer<typeof broCodeEventsSchema>

/**
 * TaskEvent
 */

export const taskEventSchema = z.discriminatedUnion("eventName", [
	// Task Provider Lifecycle
	z.object({
		eventName: z.literal(BroCodeEventName.TaskCreated),
		payload: broCodeEventsSchema.shape[BroCodeEventName.TaskCreated],
		taskId: z.number().optional(),
	}),

	// Task Lifecycle
	z.object({
		eventName: z.literal(BroCodeEventName.TaskStarted),
		payload: broCodeEventsSchema.shape[BroCodeEventName.TaskStarted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BroCodeEventName.TaskCompleted),
		payload: broCodeEventsSchema.shape[BroCodeEventName.TaskCompleted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BroCodeEventName.TaskAborted),
		payload: broCodeEventsSchema.shape[BroCodeEventName.TaskAborted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BroCodeEventName.TaskFocused),
		payload: broCodeEventsSchema.shape[BroCodeEventName.TaskFocused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BroCodeEventName.TaskUnfocused),
		payload: broCodeEventsSchema.shape[BroCodeEventName.TaskUnfocused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BroCodeEventName.TaskActive),
		payload: broCodeEventsSchema.shape[BroCodeEventName.TaskActive],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BroCodeEventName.TaskInteractive),
		payload: broCodeEventsSchema.shape[BroCodeEventName.TaskInteractive],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BroCodeEventName.TaskResumable),
		payload: broCodeEventsSchema.shape[BroCodeEventName.TaskResumable],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BroCodeEventName.TaskIdle),
		payload: broCodeEventsSchema.shape[BroCodeEventName.TaskIdle],
		taskId: z.number().optional(),
	}),

	// Subtask Lifecycle
	z.object({
		eventName: z.literal(BroCodeEventName.TaskPaused),
		payload: broCodeEventsSchema.shape[BroCodeEventName.TaskPaused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BroCodeEventName.TaskUnpaused),
		payload: broCodeEventsSchema.shape[BroCodeEventName.TaskUnpaused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BroCodeEventName.TaskSpawned),
		payload: broCodeEventsSchema.shape[BroCodeEventName.TaskSpawned],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BroCodeEventName.TaskDelegated),
		payload: broCodeEventsSchema.shape[BroCodeEventName.TaskDelegated],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BroCodeEventName.TaskDelegationCompleted),
		payload: broCodeEventsSchema.shape[BroCodeEventName.TaskDelegationCompleted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BroCodeEventName.TaskDelegationResumed),
		payload: broCodeEventsSchema.shape[BroCodeEventName.TaskDelegationResumed],
		taskId: z.number().optional(),
	}),

	// Task Execution
	z.object({
		eventName: z.literal(BroCodeEventName.Message),
		payload: broCodeEventsSchema.shape[BroCodeEventName.Message],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BroCodeEventName.TaskModeSwitched),
		payload: broCodeEventsSchema.shape[BroCodeEventName.TaskModeSwitched],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BroCodeEventName.TaskAskResponded),
		payload: broCodeEventsSchema.shape[BroCodeEventName.TaskAskResponded],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BroCodeEventName.QueuedMessagesUpdated),
		payload: broCodeEventsSchema.shape[BroCodeEventName.QueuedMessagesUpdated],
		taskId: z.number().optional(),
	}),

	// Task Analytics
	z.object({
		eventName: z.literal(BroCodeEventName.TaskToolFailed),
		payload: broCodeEventsSchema.shape[BroCodeEventName.TaskToolFailed],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BroCodeEventName.TaskTokenUsageUpdated),
		payload: broCodeEventsSchema.shape[BroCodeEventName.TaskTokenUsageUpdated],
		taskId: z.number().optional(),
	}),

	// Query Responses
	z.object({
		eventName: z.literal(BroCodeEventName.CommandsResponse),
		payload: broCodeEventsSchema.shape[BroCodeEventName.CommandsResponse],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BroCodeEventName.ModesResponse),
		payload: broCodeEventsSchema.shape[BroCodeEventName.ModesResponse],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BroCodeEventName.ModelsResponse),
		payload: broCodeEventsSchema.shape[BroCodeEventName.ModelsResponse],
		taskId: z.number().optional(),
	}),
])

export type TaskEvent = z.infer<typeof taskEventSchema>
