import { NativeToolCallParser } from "../NativeToolCallParser"

const attemptCompletionTool = {
	type: "function" as const,
	function: {
		name: "attempt_completion",
		description: "",
		parameters: {
			type: "object",
			properties: { result: { type: "string" } },
			required: ["result"],
		},
	},
}

const readFileTool = {
	type: "function" as const,
	function: {
		name: "read_file",
		description: "",
		parameters: {
			type: "object",
			properties: { path: { type: "string" }, mode: { type: "string" }, offset: {}, limit: {} },
			required: ["path"],
		},
	},
}

const tools = [attemptCompletionTool, readFileTool]

describe("smoke: detectToolCallAttempt multi-pass", () => {
	it("bare JSON", () => {
		const r = NativeToolCallParser.detectToolCallAttempt(`{ "result": "done" }`, tools)
		expect(r).toEqual({ name: "attempt_completion", arguments: JSON.stringify({ result: "done" }) })
	})

	it("self-closing no attrs", () => {
		const r = NativeToolCallParser.detectToolCallAttempt(`<attempt_completion/>`, tools)
		expect(r).toEqual({ name: "attempt_completion", arguments: "{}" })
	})

	it("self-closing with attribute", () => {
		const r = NativeToolCallParser.detectToolCallAttempt(`<attempt_completion result="All done."/>`, tools)
		expect(r).toEqual({ name: "attempt_completion", arguments: JSON.stringify({ result: "All done." }) })
	})

	it("wrapped JSON", () => {
		const r = NativeToolCallParser.detectToolCallAttempt(
			`<attempt_completion>{"result": "done"}</attempt_completion>`,
			tools,
		)
		expect(r).toEqual({ name: "attempt_completion", arguments: `{"result": "done"}` })
	})

	it("legacy multi-child XML", () => {
		const r = NativeToolCallParser.detectToolCallAttempt(
			`<read_file><path>src/entities/EmailBoss.ts</path><mode>slice</mode><offset>170</offset><limit>20</limit></read_file>`,
			tools,
		)
		expect(r).toEqual({
			name: "read_file",
			arguments: JSON.stringify({ path: "src/entities/EmailBoss.ts", mode: "slice", offset: "170", limit: "20" }),
		})
	})

	it("unrecognized tool name is left alone", () => {
		const r = NativeToolCallParser.detectToolCallAttempt(`<vscode.executeTypeScriptProvide/>`, tools)
		expect(r).toBeNull()
	})

	it("getBufferStatus: streaming-safe completeness", () => {
		expect(NativeToolCallParser.getBufferStatus(`<attempt_completion result="partial`)).toBe("incomplete")
		expect(NativeToolCallParser.getBufferStatus(`<attempt_completion result="All done."/>`)).toBe("balanced")
		expect(NativeToolCallParser.getBufferStatus(`<read_file><path>a.ts</path><mode>slice`)).toBe("incomplete")
		expect(NativeToolCallParser.getBufferStatus(`<read_file><path>a.ts</path><mode>slice</mode></read_file>`)).toBe(
			"balanced",
		)
	})
})
