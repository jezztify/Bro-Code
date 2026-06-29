// pnpm --filter bro-code test core/task-persistence/__tests__/StateStore.spec.ts

import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

import {
	getStateDir,
	listArtifacts,
	readArtifact,
	sanitizeKey,
	StateKeyError,
	StateSchemaError,
	writeArtifact,
} from "../StateStore"

describe("StateStore", () => {
	let tmpDir: string
	const rootTaskId = "root-task-1"

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "state-store-test-"))
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	describe("sanitizeKey", () => {
		it("accepts alphanumeric/dash/underscore keys", () => {
			expect(sanitizeKey("api-contract_v2")).toBe("api-contract_v2")
		})

		it.each(["", "../escape", "/abs/path", "has space", "a/b"])("rejects %s", (key) => {
			expect(() => sanitizeKey(key)).toThrow(StateKeyError)
		})
	})

	describe("write/read round trip", () => {
		it("writes and reads back a json artifact", async () => {
			await writeArtifact(tmpDir, rootTaskId, "plan", JSON.stringify({ steps: ["a", "b"] }), "json")
			const artifact = await readArtifact(tmpDir, rootTaskId, "plan")

			expect(artifact).not.toBeNull()
			expect(artifact?.format).toBe("json")
			expect(JSON.parse(artifact!.content)).toEqual({ steps: ["a", "b"] })
		})

		it("writes and reads back a markdown artifact", async () => {
			await writeArtifact(tmpDir, rootTaskId, "findings", "# Findings\n\nIt works.", "markdown")
			const artifact = await readArtifact(tmpDir, rootTaskId, "findings")

			expect(artifact).not.toBeNull()
			expect(artifact?.format).toBe("markdown")
			expect(artifact?.content).toBe("# Findings\n\nIt works.")
		})

		it("returns null for a key that was never written", async () => {
			expect(await readArtifact(tmpDir, rootTaskId, "missing")).toBeNull()
		})

		it("reflects edits made directly on disk between reads", async () => {
			await writeArtifact(tmpDir, rootTaskId, "plan", JSON.stringify({ steps: [] }), "json")
			const filePath = path.join(getStateDir(tmpDir, rootTaskId), "plan.json")

			await fs.writeFile(filePath, JSON.stringify({ steps: ["edited-by-human"] }), "utf8")

			const artifact = await readArtifact(tmpDir, rootTaskId, "plan")
			expect(JSON.parse(artifact!.content)).toEqual({ steps: ["edited-by-human"] })
		})

		it("rejects invalid JSON content when format is json", async () => {
			await expect(writeArtifact(tmpDir, rootTaskId, "plan", "not json", "json")).rejects.toThrow(
				StateSchemaError,
			)
		})

		it("removes the stale file when a key's format changes", async () => {
			await writeArtifact(tmpDir, rootTaskId, "thing", JSON.stringify({ a: 1 }), "json")
			await writeArtifact(tmpDir, rootTaskId, "thing", "now markdown", "markdown")

			const dir = getStateDir(tmpDir, rootTaskId)
			const entries = await fs.readdir(dir)
			expect(entries).toEqual(["thing.md"])
		})

		it("does not affect unrelated keys", async () => {
			await writeArtifact(tmpDir, rootTaskId, "a", JSON.stringify({ v: 1 }), "json")
			await writeArtifact(tmpDir, rootTaskId, "b", JSON.stringify({ v: 2 }), "json")

			expect(JSON.parse((await readArtifact(tmpDir, rootTaskId, "a"))!.content)).toEqual({ v: 1 })
			expect(JSON.parse((await readArtifact(tmpDir, rootTaskId, "b"))!.content)).toEqual({ v: 2 })
		})
	})

	describe("schema enforcement", () => {
		async function writeSchema(keys: Record<string, { format: "json" | "markdown" }>) {
			const dir = getStateDir(tmpDir, rootTaskId)
			await fs.mkdir(dir, { recursive: true })
			await fs.writeFile(path.join(dir, "_schema.json"), JSON.stringify({ version: 1, keys }), "utf8")
		}

		it("is permissive when no schema file exists", async () => {
			await expect(writeArtifact(tmpDir, rootTaskId, "anything", "{}", "json")).resolves.not.toThrow()
		})

		it("rejects keys not declared in the schema", async () => {
			await writeSchema({ "api-contract": { format: "json" } })

			await expect(writeArtifact(tmpDir, rootTaskId, "undeclared", "{}", "json")).rejects.toThrow(
				StateSchemaError,
			)
		})

		it("rejects a format mismatch against the schema", async () => {
			await writeSchema({ findings: { format: "markdown" } })

			await expect(writeArtifact(tmpDir, rootTaskId, "findings", "{}", "json")).rejects.toThrow(StateSchemaError)
		})

		it("allows a declared key with the matching format", async () => {
			await writeSchema({ "api-contract": { format: "json" } })

			await expect(
				writeArtifact(tmpDir, rootTaskId, "api-contract", JSON.stringify({ ok: true }), "json"),
			).resolves.not.toThrow()
		})
	})

	describe("listArtifacts", () => {
		it("lists written artifacts and excludes the schema file", async () => {
			await writeArtifact(tmpDir, rootTaskId, "plan", "{}", "json")
			await writeArtifact(tmpDir, rootTaskId, "findings", "notes", "markdown")
			const dir = getStateDir(tmpDir, rootTaskId)
			await fs.writeFile(path.join(dir, "_schema.json"), JSON.stringify({ version: 1, keys: {} }), "utf8")

			const artifacts = await listArtifacts(tmpDir, rootTaskId)
			const keys = artifacts.map((a) => a.key).sort()

			expect(keys).toEqual(["findings", "plan"])
		})

		it("returns an empty array when the task has no state directory yet", async () => {
			expect(await listArtifacts(tmpDir, "no-such-task")).toEqual([])
		})
	})
})
