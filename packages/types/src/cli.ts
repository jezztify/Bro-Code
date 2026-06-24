import { z } from "zod"

import { broCodeSettingsSchema } from "./global-settings.js"

/**
 * Bro CLI stdin commands
 */

export const broCliCommandNames = ["start", "message", "cancel", "ping", "shutdown"] as const

export const broCliCommandNameSchema = z.enum(broCliCommandNames)

export type BroCliCommandName = z.infer<typeof broCliCommandNameSchema>

export const broCliCommandBaseSchema = z.object({
	command: broCliCommandNameSchema,
	requestId: z.string().min(1),
})

export type BroCliCommandBase = z.infer<typeof broCliCommandBaseSchema>

const broCliSessionIdSchema = z
	.string()
	.trim()
	.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)

export const broCliStartCommandSchema = broCliCommandBaseSchema.extend({
	command: z.literal("start"),
	prompt: z.string(),
	taskId: broCliSessionIdSchema.optional(),
	images: z.array(z.string()).optional(),
	configuration: broCodeSettingsSchema.optional(),
})

export type BroCliStartCommand = z.infer<typeof broCliStartCommandSchema>

export const broCliMessageCommandSchema = broCliCommandBaseSchema.extend({
	command: z.literal("message"),
	prompt: z.string(),
	images: z.array(z.string()).optional(),
})

export type BroCliMessageCommand = z.infer<typeof broCliMessageCommandSchema>

export const broCliCancelCommandSchema = broCliCommandBaseSchema.extend({
	command: z.literal("cancel"),
})

export type BroCliCancelCommand = z.infer<typeof broCliCancelCommandSchema>

export const broCliPingCommandSchema = broCliCommandBaseSchema.extend({
	command: z.literal("ping"),
})

export type BroCliPingCommand = z.infer<typeof broCliPingCommandSchema>

export const broCliShutdownCommandSchema = broCliCommandBaseSchema.extend({
	command: z.literal("shutdown"),
})

export type BroCliShutdownCommand = z.infer<typeof broCliShutdownCommandSchema>

export const broCliInputCommandSchema = z.discriminatedUnion("command", [
	broCliStartCommandSchema,
	broCliMessageCommandSchema,
	broCliCancelCommandSchema,
	broCliPingCommandSchema,
	broCliShutdownCommandSchema,
])

export type BroCliInputCommand = z.infer<typeof broCliInputCommandSchema>

/**
 * Bro CLI stream-json output
 */

export const broCliOutputFormats = ["text", "json", "stream-json"] as const

export const broCliOutputFormatSchema = z.enum(broCliOutputFormats)

export type BroCliOutputFormat = z.infer<typeof broCliOutputFormatSchema>

export const broCliEventTypes = [
	"system",
	"control",
	"queue",
	"assistant",
	"user",
	"tool_use",
	"tool_result",
	"thinking",
	"error",
	"result",
] as const

export const broCliEventTypeSchema = z.enum(broCliEventTypes)

export type BroCliEventType = z.infer<typeof broCliEventTypeSchema>

export const broCliControlSubtypes = ["ack", "done", "error"] as const

export const broCliControlSubtypeSchema = z.enum(broCliControlSubtypes)

export type BroCliControlSubtype = z.infer<typeof broCliControlSubtypeSchema>

export const broCliQueueItemSchema = z.object({
	id: z.string().min(1),
	text: z.string().optional(),
	imageCount: z.number().optional(),
	timestamp: z.number().optional(),
})

export type BroCliQueueItem = z.infer<typeof broCliQueueItemSchema>

export const broCliToolUseSchema = z.object({
	name: z.string(),
	input: z.record(z.unknown()).optional(),
})

export type BroCliToolUse = z.infer<typeof broCliToolUseSchema>

export const broCliToolResultSchema = z.object({
	name: z.string(),
	output: z.string().optional(),
	error: z.string().optional(),
	exitCode: z.number().optional(),
})

export type BroCliToolResult = z.infer<typeof broCliToolResultSchema>

export const broCliCostSchema = z.object({
	totalCost: z.number().optional(),
	inputTokens: z.number().optional(),
	outputTokens: z.number().optional(),
	cacheWrites: z.number().optional(),
	cacheReads: z.number().optional(),
})

export type BroCliCost = z.infer<typeof broCliCostSchema>

export const broCliStreamEventSchema = z
	.object({
		type: broCliEventTypeSchema.optional(),
		subtype: z.string().optional(),
		requestId: z.string().optional(),
		command: broCliCommandNameSchema.optional(),
		taskId: z.string().optional(),
		code: z.string().optional(),
		content: z.string().optional(),
		success: z.boolean().optional(),
		id: z.number().optional(),
		done: z.boolean().optional(),
		queueDepth: z.number().optional(),
		queue: z.array(broCliQueueItemSchema).optional(),
		schemaVersion: z.number().optional(),
		protocol: z.string().optional(),
		capabilities: z.array(z.string()).optional(),
		tool_use: broCliToolUseSchema.optional(),
		tool_result: broCliToolResultSchema.optional(),
		cost: broCliCostSchema.optional(),
	})
	.passthrough()

export type BroCliStreamEvent = z.infer<typeof broCliStreamEventSchema>

export const broCliControlEventSchema = broCliStreamEventSchema.extend({
	type: z.literal("control"),
	subtype: broCliControlSubtypeSchema,
	requestId: z.string().min(1),
})

export type BroCliControlEvent = z.infer<typeof broCliControlEventSchema>

export const broCliFinalOutputSchema = z.object({
	type: z.literal("result"),
	success: z.boolean(),
	content: z.string().optional(),
	cost: broCliCostSchema.optional(),
	events: z.array(broCliStreamEventSchema),
})

export type BroCliFinalOutput = z.infer<typeof broCliFinalOutputSchema>
