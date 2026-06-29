import * as fs from "fs/promises"
import * as path from "path"

import { safeWriteJson } from "../../utils/safeWriteJson"
import { fileExistsAtPath } from "../../utils/fs"

export type StateArtifactFormat = "json" | "markdown"

export interface StateArtifact {
	key: string
	format: StateArtifactFormat
	content: string
	mtime: number
}

export interface StateSchemaEntry {
	format: StateArtifactFormat
	description?: string
}

export interface StateSchema {
	version: 1
	keys: Record<string, StateSchemaEntry>
}

export class StateKeyError extends Error {}
export class StateSchemaError extends Error {}

const SCHEMA_FILE_NAME = "_schema.json"
const VALID_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/

const EXTENSION_BY_FORMAT: Record<StateArtifactFormat, string> = {
	json: ".json",
	markdown: ".md",
}

/**
 * Validates an artifact key and returns it unchanged.
 *
 * Keys are restricted to a safe character set (no path separators, no `..`)
 * so the resulting file path can never escape the task's state directory.
 */
export function sanitizeKey(key: string): string {
	if (!key || !VALID_KEY_PATTERN.test(key)) {
		throw new StateKeyError(
			`Invalid state key "${key}". Keys must be non-empty and contain only letters, numbers, "-", and "_".`,
		)
	}
	return key
}

export function getStateDir(workspaceRoot: string, rootTaskId: string): string {
	return path.join(workspaceRoot, ".brocode", "state", rootTaskId)
}

function getArtifactPath(workspaceRoot: string, rootTaskId: string, key: string, format: StateArtifactFormat): string {
	return path.join(getStateDir(workspaceRoot, rootTaskId), `${sanitizeKey(key)}${EXTENSION_BY_FORMAT[format]}`)
}

function getSchemaPath(workspaceRoot: string, rootTaskId: string): string {
	return path.join(getStateDir(workspaceRoot, rootTaskId), SCHEMA_FILE_NAME)
}

/**
 * Loads the optional per-workflow state contract (`_schema.json`).
 * Returns `null` if no schema has been declared (permissive mode).
 */
export async function loadSchema(workspaceRoot: string, rootTaskId: string): Promise<StateSchema | null> {
	const schemaPath = getSchemaPath(workspaceRoot, rootTaskId)

	if (!(await fileExistsAtPath(schemaPath))) {
		return null
	}

	try {
		const raw = await fs.readFile(schemaPath, "utf8")
		const parsed = JSON.parse(raw)
		if (parsed && typeof parsed === "object" && parsed.keys && typeof parsed.keys === "object") {
			return parsed as StateSchema
		}
		return null
	} catch {
		return null
	}
}

/**
 * Validates a write against the schema, if one is declared.
 * Returns an error message if the write is rejected, or `undefined` if allowed.
 */
export async function validateAgainstSchema(
	workspaceRoot: string,
	rootTaskId: string,
	key: string,
	format: StateArtifactFormat,
): Promise<string | undefined> {
	const schema = await loadSchema(workspaceRoot, rootTaskId)

	if (!schema) {
		return undefined
	}

	const entry = schema.keys[key]

	if (!entry) {
		return `Key "${key}" is not declared in this workflow's state schema (${SCHEMA_FILE_NAME}). Declared keys: ${Object.keys(schema.keys).join(", ") || "(none)"}`
	}

	if (entry.format !== format) {
		return `Key "${key}" is declared as format "${entry.format}" in the state schema, but "${format}" was provided.`
	}

	return undefined
}

/**
 * Reads the current on-disk content of a state artifact, trying both
 * known formats. Always reads fresh from disk (no caching), so hand
 * edits made mid-run are picked up immediately.
 */
export async function readArtifact(
	workspaceRoot: string,
	rootTaskId: string,
	key: string,
): Promise<StateArtifact | null> {
	sanitizeKey(key)

	for (const format of Object.keys(EXTENSION_BY_FORMAT) as StateArtifactFormat[]) {
		const filePath = getArtifactPath(workspaceRoot, rootTaskId, key, format)

		try {
			const [content, stat] = await Promise.all([fs.readFile(filePath, "utf8"), fs.stat(filePath)])
			return { key, format, content, mtime: stat.mtimeMs }
		} catch (error: any) {
			if (error?.code !== "ENOENT") {
				throw error
			}
		}
	}

	return null
}

/**
 * Writes a state artifact, validating against the workflow's schema
 * (if declared) and against JSON well-formedness when format is "json".
 *
 * Writing key "X" never touches any other key's file.
 */
export async function writeArtifact(
	workspaceRoot: string,
	rootTaskId: string,
	key: string,
	content: string,
	format: StateArtifactFormat = "json",
): Promise<void> {
	sanitizeKey(key)

	if (format === "json") {
		try {
			JSON.parse(content)
		} catch (error) {
			throw new StateSchemaError(
				`Content for key "${key}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	const schemaError = await validateAgainstSchema(workspaceRoot, rootTaskId, key, format)
	if (schemaError) {
		throw new StateSchemaError(schemaError)
	}

	const filePath = getArtifactPath(workspaceRoot, rootTaskId, key, format)

	if (format === "json") {
		// Write the raw parsed value, not a JSON-encoded string, so the file is plain readable JSON.
		await safeWriteJson(filePath, JSON.parse(content))
	} else {
		await writeFileAtomic(filePath, content)
	}

	// If a previous write used the other format for this key, remove the stale file
	// so readArtifact() doesn't find two conflicting copies of the same key.
	const otherFormat: StateArtifactFormat = format === "json" ? "markdown" : "json"
	const otherPath = getArtifactPath(workspaceRoot, rootTaskId, key, otherFormat)
	try {
		await fs.unlink(otherPath)
	} catch {
		// Fine if it never existed.
	}
}

/**
 * Lists all artifacts (excluding the schema file) currently on disk for a task.
 */
export async function listArtifacts(
	workspaceRoot: string,
	rootTaskId: string,
): Promise<Array<{ key: string; format: StateArtifactFormat; mtime: number }>> {
	const dir = getStateDir(workspaceRoot, rootTaskId)

	let entries: string[]
	try {
		entries = await fs.readdir(dir)
	} catch {
		return []
	}

	const artifacts: Array<{ key: string; format: StateArtifactFormat; mtime: number }> = []

	for (const entry of entries) {
		if (entry === SCHEMA_FILE_NAME) {
			continue
		}

		let key: string
		let format: StateArtifactFormat
		if (entry.endsWith(".json")) {
			key = entry.slice(0, -".json".length)
			format = "json"
		} else if (entry.endsWith(".md")) {
			key = entry.slice(0, -".md".length)
			format = "markdown"
		} else {
			continue
		}

		try {
			const stat = await fs.stat(path.join(dir, entry))
			artifacts.push({ key, format, mtime: stat.mtimeMs })
		} catch {
			// File disappeared between readdir and stat; skip it.
		}
	}

	return artifacts
}

/**
 * Atomically writes a plain-text file (temp file + rename), mirroring the
 * commit step of `safeWriteJson` for non-JSON artifacts.
 */
async function writeFileAtomic(filePath: string, content: string): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true })
	const tempPath = path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.new_${Date.now()}_${Math.random().toString(36).slice(2)}.tmp`,
	)
	await fs.writeFile(tempPath, content, "utf8")
	await fs.rename(tempPath, filePath)
}
