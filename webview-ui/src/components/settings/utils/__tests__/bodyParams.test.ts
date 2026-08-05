// npx vitest run src/components/settings/utils/__tests__/bodyParams.test.ts

import { convertBodyParamsToObject, convertObjectToBodyParams, parseBodyParamValue } from "../bodyParams"

describe("parseBodyParamValue", () => {
	it("parses JSON literals", () => {
		expect(parseBodyParamValue("true")).toBe(true)
		expect(parseBodyParamValue("false")).toBe(false)
		expect(parseBodyParamValue("42")).toBe(42)
		expect(parseBodyParamValue("1.5")).toBe(1.5)
		expect(parseBodyParamValue("null")).toBe(null)
	})

	it("parses JSON objects and arrays", () => {
		expect(parseBodyParamValue('{"a":1}')).toEqual({ a: 1 })
		expect(parseBodyParamValue("[1, 2, 3]")).toEqual([1, 2, 3])
	})

	it("falls back to the raw string for non-JSON input", () => {
		expect(parseBodyParamValue("ba9e4d54bee646779e88e6e9cfdce295")).toBe("ba9e4d54bee646779e88e6e9cfdce295")
		expect(parseBodyParamValue("hello world")).toBe("hello world")
	})

	it("returns an empty string for blank input", () => {
		expect(parseBodyParamValue("")).toBe("")
		expect(parseBodyParamValue("   ")).toBe("")
	})
})

describe("convertBodyParamsToObject", () => {
	it("builds an object from tuples", () => {
		expect(
			convertBodyParamsToObject([
				["custom_key", "true"],
				["sessionId", "abc123"],
			]),
		).toEqual({ custom_key: true, sessionId: "abc123" })
	})

	it("trims and skips empty keys", () => {
		expect(
			convertBodyParamsToObject([
				["  custom_key  ", "1"],
				["", "ignored"],
				["   ", "ignored"],
			]),
		).toEqual({ custom_key: 1 })
	})

	it("lets the last duplicate win", () => {
		expect(
			convertBodyParamsToObject([
				["custom_key", "1"],
				["custom_key", "2"],
			]),
		).toEqual({ custom_key: 2 })
	})
})

describe("convertObjectToBodyParams", () => {
	it("round-trips values back into editable text", () => {
		expect(convertObjectToBodyParams({ custom_key: true, sessionId: "abc", nested: { a: 1 } })).toEqual([
			["custom_key", "true"],
			["sessionId", "abc"],
			["nested", '{"a":1}'],
		])
	})

	it("handles an undefined config", () => {
		expect(convertObjectToBodyParams(undefined)).toEqual([])
	})
})
