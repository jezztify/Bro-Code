// npx vitest run __tests__/delegation-events.spec.ts

import { BroCodeEventName, broCodeEventsSchema, taskEventSchema } from "@bro-code/types"

describe("delegation event schemas", () => {
	test("broCodeEventsSchema validates tuples", () => {
		expect(() => (broCodeEventsSchema.shape as any)[BroCodeEventName.TaskDelegated].parse(["p", "c"])).not.toThrow()
		expect(() =>
			(broCodeEventsSchema.shape as any)[BroCodeEventName.TaskDelegationCompleted].parse(["p", "c", "s"]),
		).not.toThrow()
		expect(() =>
			(broCodeEventsSchema.shape as any)[BroCodeEventName.TaskDelegationResumed].parse(["p", "c"]),
		).not.toThrow()

		// invalid shapes
		expect(() => (broCodeEventsSchema.shape as any)[BroCodeEventName.TaskDelegated].parse(["p"])).toThrow()
		expect(() =>
			(broCodeEventsSchema.shape as any)[BroCodeEventName.TaskDelegationCompleted].parse(["p", "c"]),
		).toThrow()
		expect(() => (broCodeEventsSchema.shape as any)[BroCodeEventName.TaskDelegationResumed].parse(["p"])).toThrow()
	})

	test("taskEventSchema discriminated union includes delegation events", () => {
		expect(() =>
			taskEventSchema.parse({
				eventName: BroCodeEventName.TaskDelegated,
				payload: ["p", "c"],
				taskId: 1,
			}),
		).not.toThrow()

		expect(() =>
			taskEventSchema.parse({
				eventName: BroCodeEventName.TaskDelegationCompleted,
				payload: ["p", "c", "s"],
				taskId: 1,
			}),
		).not.toThrow()

		expect(() =>
			taskEventSchema.parse({
				eventName: BroCodeEventName.TaskDelegationResumed,
				payload: ["p", "c"],
				taskId: 1,
			}),
		).not.toThrow()
	})
})
