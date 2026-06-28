import path from "path"
import { BroProtectedController } from "../BroProtectedController"

describe("BroProtectedController", () => {
	const TEST_CWD = "/test/workspace"
	let controller: BroProtectedController

	beforeEach(() => {
		controller = new BroProtectedController(TEST_CWD)
	})

	describe("isWriteProtected", () => {
		it("should protect .broignore file", () => {
			expect(controller.isWriteProtected(".broignore")).toBe(true)
		})

		it("should protect files in .bro directory", () => {
			expect(controller.isWriteProtected(".bro/config.json")).toBe(true)
			expect(controller.isWriteProtected(".bro/settings/user.json")).toBe(true)
			expect(controller.isWriteProtected(".bro/modes/custom.json")).toBe(true)
		})

		it("should protect .broprotected file", () => {
			expect(controller.isWriteProtected(".broprotected")).toBe(true)
		})

		it("should protect .bromodes files", () => {
			expect(controller.isWriteProtected(".bromodes")).toBe(true)
		})

		it("should protect .brorules* files", () => {
			expect(controller.isWriteProtected(".brorules")).toBe(true)
			expect(controller.isWriteProtected(".brorules.md")).toBe(true)
		})

		it("should protect .clinerules* files", () => {
			expect(controller.isWriteProtected(".clinerules")).toBe(true)
			expect(controller.isWriteProtected(".clinerules.md")).toBe(true)
		})

		it("should protect files in .vscode directory", () => {
			expect(controller.isWriteProtected(".vscode/settings.json")).toBe(true)
			expect(controller.isWriteProtected(".vscode/launch.json")).toBe(true)
			expect(controller.isWriteProtected(".vscode/tasks.json")).toBe(true)
		})

		it("should protect .code-workspace files", () => {
			expect(controller.isWriteProtected("myproject.code-workspace")).toBe(true)
			expect(controller.isWriteProtected("pentest.code-workspace")).toBe(true)
			expect(controller.isWriteProtected(".code-workspace")).toBe(true)
			expect(controller.isWriteProtected("folder/workspace.code-workspace")).toBe(true)
		})

		it("should protect AGENTS.md file", () => {
			expect(controller.isWriteProtected("AGENTS.md")).toBe(true)
		})

		it("should protect AGENT.md file", () => {
			expect(controller.isWriteProtected("AGENT.md")).toBe(true)
		})

		it("should not protect other files starting with .bro", () => {
			expect(controller.isWriteProtected(".brosettings")).toBe(false)
			expect(controller.isWriteProtected(".broconfig")).toBe(false)
		})

		it("should not protect regular files", () => {
			expect(controller.isWriteProtected("src/index.ts")).toBe(false)
			expect(controller.isWriteProtected("package.json")).toBe(false)
			expect(controller.isWriteProtected("README.md")).toBe(false)
		})

		it("should not protect files that contain 'bro' but don't start with .bro", () => {
			expect(controller.isWriteProtected("src/bro-utils.ts")).toBe(false)
			expect(controller.isWriteProtected("config/bro.config.js")).toBe(false)
		})

		it("should handle nested paths correctly", () => {
			expect(controller.isWriteProtected(".bro/config.json")).toBe(true) // .bro/** matches at root
			expect(controller.isWriteProtected("nested/.broignore")).toBe(true) // .broignore matches anywhere by default
			expect(controller.isWriteProtected("nested/.bromodes")).toBe(true) // .bromodes matches anywhere by default
			expect(controller.isWriteProtected("nested/.brorules.md")).toBe(true) // .brorules* matches anywhere by default
		})

		it("should handle absolute paths by converting to relative", () => {
			const absolutePath = path.join(TEST_CWD, ".broignore")
			expect(controller.isWriteProtected(absolutePath)).toBe(true)
		})

		it("should handle paths with different separators", () => {
			expect(controller.isWriteProtected(".bro\\config.json")).toBe(true)
			expect(controller.isWriteProtected(".bro/config.json")).toBe(true)
		})

		it("should not throw for absolute paths outside cwd", () => {
			expect(controller.isWriteProtected("/tmp/comment-2-pr63.json")).toBe(false)
			expect(controller.isWriteProtected("/etc/passwd")).toBe(false)
		})
	})

	describe("getProtectedFiles", () => {
		it("should return set of protected files from a list", () => {
			const files = ["src/index.ts", ".broignore", "package.json", ".bro/config.json", "README.md"]

			const protectedFiles = controller.getProtectedFiles(files)

			expect(protectedFiles).toEqual(new Set([".broignore", ".bro/config.json"]))
		})

		it("should return empty set when no files are protected", () => {
			const files = ["src/index.ts", "package.json", "README.md"]

			const protectedFiles = controller.getProtectedFiles(files)

			expect(protectedFiles).toEqual(new Set())
		})
	})

	describe("annotatePathsWithProtection", () => {
		it("should annotate paths with protection status", () => {
			const files = ["src/index.ts", ".broignore", ".bro/config.json", "package.json"]

			const annotated = controller.annotatePathsWithProtection(files)

			expect(annotated).toEqual([
				{ path: "src/index.ts", isProtected: false },
				{ path: ".broignore", isProtected: true },
				{ path: ".bro/config.json", isProtected: true },
				{ path: "package.json", isProtected: false },
			])
		})
	})

	describe("getProtectionMessage", () => {
		it("should return appropriate protection message", () => {
			const message = controller.getProtectionMessage()
			expect(message).toBe("This is a Bro configuration file and requires approval for modifications")
		})
	})

	describe("getInstructions", () => {
		it("should return formatted instructions about protected files", () => {
			const instructions = controller.getInstructions()

			expect(instructions).toContain("# Protected Files")
			expect(instructions).toContain("write-protected")
			expect(instructions).toContain(".broignore")
			expect(instructions).toContain(".bro/**")
			expect(instructions).toContain("\u{1F6E1}") // Shield symbol
		})
	})

	describe("getProtectedPatterns", () => {
		it("should return the list of protected patterns", () => {
			const patterns = BroProtectedController.getProtectedPatterns()

			expect(patterns).toEqual([
				".broignore",
				".bromodes",
				".brorules*",
				".clinerules*",
				".bro/**",
				".brocode/**",
				".vscode/**",
				"*.code-workspace",
				".broprotected",
				"AGENTS.md",
				"AGENT.md",
			])
		})
	})
})
