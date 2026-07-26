import { levenshteinDistance, findClosestMatch } from "../text-similarity"

describe("levenshteinDistance", () => {
	it("returns 0 for identical strings", () => {
		expect(levenshteinDistance("abc", "abc")).toBe(0)
	})

	it("counts insertions", () => {
		expect(levenshteinDistance("abc", "abcde")).toBe(2)
	})

	it("counts substitutions", () => {
		expect(levenshteinDistance("abc", "abd")).toBe(1)
	})

	it("handles empty strings", () => {
		expect(levenshteinDistance("", "abc")).toBe(3)
		expect(levenshteinDistance("abc", "")).toBe(3)
		expect(levenshteinDistance("", "")).toBe(0)
	})
})

describe("findClosestMatch", () => {
	it("returns the single unambiguous near-miss", () => {
		expect(findClosestMatch("old_str", ["old_string", "new_string"], (s) => s)).toBe("old_string")
	})

	it("returns null when the requested string is too short", () => {
		expect(findClosestMatch("go", ["get_page", "get_pages"], (s) => s)).toBeNull()
	})

	it("returns null when no candidate is within the distance threshold", () => {
		expect(findClosestMatch("frobnicate_widget", ["old_string", "new_string"], (s) => s)).toBeNull()
	})

	it("returns null when two candidates tie", () => {
		expect(findClosestMatch("get_pag", ["get_page", "get_bag"], (s) => s)).toBeNull()
	})

	it("returns null for an empty candidate list", () => {
		expect(findClosestMatch("old_str", [], (s) => s)).toBeNull()
	})

	it("supports non-string candidates via getKey", () => {
		const candidates = [{ name: "old_string" }, { name: "new_string" }]
		expect(findClosestMatch("old_str", candidates, (c) => c.name)).toEqual({ name: "old_string" })
	})
})
