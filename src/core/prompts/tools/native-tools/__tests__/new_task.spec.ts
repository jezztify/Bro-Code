// npx vitest run core/prompts/tools/native-tools/__tests__/new_task.spec.ts

import type OpenAI from "openai"
import { createNewTaskTool } from "../new_task"

type FunctionTool = OpenAI.Chat.ChatCompletionTool & { type: "function" }

const getFunctionDef = (tool: OpenAI.Chat.ChatCompletionTool) => (tool as FunctionTool).function

const getParam = (tool: OpenAI.Chat.ChatCompletionTool, name: string) =>
	(getFunctionDef(tool).parameters as { properties: Record<string, { type: unknown; description: string }> })
		.properties[name]

describe("createNewTaskTool", () => {
	describe("optional parameters", () => {
		// A strict schema has to list every property in `required`, so the descriptions are the
		// only place optionality is expressed. Models that miss it invent a precondition - e.g.
		// "new_task requires either a valid todoId or a todos parameter" - and build a todo list
		// they were never asked for just to satisfy it.
		it.each(["todos", "tier", "todoId"])("tells the model null is an acceptable value for %s", (name) => {
			const param = getParam(createNewTaskTool(), name)

			expect(param.type).toEqual(expect.arrayContaining(["null"]))
			expect(param.description).toContain("Pass null")
		})

		it("tells the model that only mode and message must be supplied", () => {
			const description = getFunctionDef(createNewTaskTool()).description

			expect(description).toContain("Only mode and message carry information you must supply")
		})

		it("warns against manufacturing a todo list just to fill the parameters in", () => {
			const tool = createNewTaskTool()

			expect(getParam(tool, "todos").description).toContain("Do not draw up a todo list merely to have something")
			expect(getParam(tool, "todoId").description).toContain("never create a todo list just to obtain an id")
		})
	})

	describe("requireTodos", () => {
		it("states the workspace requirement outright rather than leaving it conditional", () => {
			const tool = createNewTaskTool({ requireTodos: true })

			expect(getFunctionDef(tool).description).toContain("todos is also mandatory in this workspace")
			expect(getParam(tool, "todos").type).toBe("string")
			expect(getParam(tool, "todos").description).toContain("may not be null")
		})

		it("does not mention the requirement when it does not apply", () => {
			const description = getFunctionDef(createNewTaskTool()).description

			expect(description).not.toContain("mandatory")
			expect(description).not.toContain("if required")
		})
	})

	it("keeps every parameter in required, as strict mode demands", () => {
		const parameters = getFunctionDef(createNewTaskTool()).parameters as { required: string[] }

		expect(getFunctionDef(createNewTaskTool()).strict).toBe(true)
		expect(parameters.required).toEqual(["mode", "message", "todos", "tier", "todoId"])
	})
})
