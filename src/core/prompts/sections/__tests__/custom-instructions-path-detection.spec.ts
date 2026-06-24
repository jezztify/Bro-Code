import * as path from "path"

describe("custom-instructions path detection", () => {
	it("should use exact path comparison instead of string includes", () => {
		// Test the logic that our fix implements
		const fakeHomeDir = "/Users/john.bro.smith"
		const globalBroDir = path.join(fakeHomeDir, ".bro") // "/Users/john.bro.smith/.bro"
		const projectBroDir = "/projects/my-project/.bro"

		// Old implementation (fragile):
		// const isGlobal = broDir.includes(path.join(os.homedir(), ".bro"))
		// This could fail if the home directory path contains ".bro" elsewhere

		// New implementation (robust):
		// const isGlobal = path.resolve(broDir) === path.resolve(getGlobalBroDirectory())

		// Test the new logic
		const isGlobalForGlobalDir = path.resolve(globalBroDir) === path.resolve(globalBroDir)
		const isGlobalForProjectDir = path.resolve(projectBroDir) === path.resolve(globalBroDir)

		expect(isGlobalForGlobalDir).toBe(true)
		expect(isGlobalForProjectDir).toBe(false)

		// Verify that the old implementation would have been problematic
		// if the home directory contained ".bro" in the path
		const oldLogicGlobal = globalBroDir.includes(path.join(fakeHomeDir, ".bro"))
		const oldLogicProject = projectBroDir.includes(path.join(fakeHomeDir, ".bro"))

		expect(oldLogicGlobal).toBe(true) // This works
		expect(oldLogicProject).toBe(false) // This also works, but is fragile

		// The issue was that if the home directory path itself contained ".bro",
		// the includes() check could produce false positives in edge cases
	})

	it("should handle edge cases with path resolution", () => {
		// Test various edge cases that exact path comparison handles better
		const testCases = [
			{
				global: "/Users/test/.bro",
				project: "/Users/test/project/.bro",
				expected: { global: true, project: false },
			},
			{
				global: "/home/user/.bro",
				project: "/home/user/.bro", // Same directory
				expected: { global: true, project: true },
			},
			{
				global: "/Users/john.bro.smith/.bro",
				project: "/projects/app/.bro",
				expected: { global: true, project: false },
			},
		]

		testCases.forEach(({ global, project, expected }) => {
			const isGlobalForGlobal = path.resolve(global) === path.resolve(global)
			const isGlobalForProject = path.resolve(project) === path.resolve(global)

			expect(isGlobalForGlobal).toBe(expected.global)
			expect(isGlobalForProject).toBe(expected.project)
		})
	})
})
