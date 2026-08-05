/**
 * Utilities for sanitizing MCP server and tool names to conform to
 * API function name requirements across all providers.
 */

import { findClosestMatch } from "./text-similarity"

/**
 * Separator used between MCP prefix, server name, and tool name.
 * We use "--" (double hyphen) because:
 * 1. It's allowed by all providers (dashes are permitted in function names)
 * 2. It won't conflict with underscores in sanitized server/tool names
 * 3. It's unique enough to be a reliable delimiter for parsing
 */
export const MCP_TOOL_SEPARATOR = "--"

/**
 * Prefix for all MCP tool function names.
 */
export const MCP_TOOL_PREFIX = "mcp"

/**
 * Maximum length of a generated function name. 64 is the strictest limit across providers
 * (Gemini and OpenAI); Anthropic allows more.
 */
export const MCP_TOOL_NAME_MAX_LENGTH = 64

/**
 * Maximum length of the server segment once a name has to be shortened. Chosen so the tool
 * segment always keeps at least 33 characters, which covers essentially every real MCP tool name.
 */
export const MCP_SERVER_SEGMENT_MAX_LENGTH = 24

/**
 * Length of the disambiguating hash appended to a shortened segment.
 */
const SEGMENT_HASH_LENGTH = 4

/**
 * FNV-1a 32-bit hash, rendered in base36. Used only to keep shortened segments distinct from
 * each other — it is not security-relevant.
 */
function hashSegment(value: string): string {
	let hash = 0x811c9dc5
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i)
		hash = Math.imul(hash, 0x01000193) >>> 0
	}
	return hash.toString(36).padStart(SEGMENT_HASH_LENGTH, "0").slice(-SEGMENT_HASH_LENGTH)
}

/**
 * Shorten a single name segment to fit `maxLength`, appending a hash of the full segment so that
 * two different names never collapse onto the same shortened form.
 *
 * Trailing separators are stripped before the hash is appended so the result can never contain
 * "__" or "--", either of which would be mistaken for a segment boundary when parsing.
 */
function capSegment(segment: string, maxLength: number): string {
	if (segment.length <= maxLength) {
		return segment
	}

	const keep = segment.slice(0, Math.max(0, maxLength - SEGMENT_HASH_LENGTH - 1)).replace(/[-_]+$/, "")
	return `${keep}_${hashSegment(segment)}`
}

/**
 * Build the server segment of an MCP function name, shortened to fit if necessary.
 * Exported so McpHub can register the shortened form for reverse lookup.
 *
 * @param serverName - The MCP server name
 * @returns The (possibly shortened) sanitized server segment
 */
export function buildMcpServerSegment(serverName: string): string {
	return capSegment(sanitizeMcpName(serverName), MCP_SERVER_SEGMENT_MAX_LENGTH)
}

/**
 * Normalize a string for comparison by treating hyphens and underscores as equivalent.
 * This is used to match tool names when models convert hyphens to underscores.
 *
 * @param name - The name to normalize
 * @returns The normalized name with all hyphens converted to underscores
 */
export function normalizeForComparison(name: string): string {
	return name.replace(/-/g, "_")
}

/**
 * Normalize an MCP tool name by converting underscore separators back to hyphens.
 * This handles the case where models (especially Claude) convert hyphens to underscores
 * in tool names when using native tool calling.
 *
 * For example: "mcp__server__tool" -> "mcp--server--tool"
 *
 * This function uses fuzzy matching - it treats hyphens and underscores as equivalent
 * when normalizing the separator pattern.
 *
 * @param toolName - The tool name that may have underscore separators
 * @returns The normalized tool name with hyphen separators
 */
export function normalizeMcpToolName(toolName: string): string {
	// Normalize for comparison to detect MCP tools regardless of separator style
	const normalized = normalizeForComparison(toolName)

	// Only normalize if it looks like an MCP tool (starts with mcp__)
	if (normalized.startsWith("mcp__")) {
		// Find the pattern: mcp{sep}server{sep}tool where sep is -- or __
		// We need to convert the separators while preserving the rest

		// First, try to parse assuming all separators are underscores
		// Pattern: mcp__server__tool or mcp__server__tool_with_underscores
		const parts = toolName.split(/__|--/)

		if (parts.length >= 3 && parts[0].toLowerCase() === "mcp") {
			// Reconstruct with proper -- separators
			const serverName = parts[1]
			const toolNamePart = parts.slice(2).join("--") // Rejoin in case tool name had separator
			return `${MCP_TOOL_PREFIX}${MCP_TOOL_SEPARATOR}${serverName}${MCP_TOOL_SEPARATOR}${toolNamePart}`
		}
	}
	return toolName
}

/**
 * Check if a tool name is an MCP tool (starts with the MCP prefix and separator).
 * Uses fuzzy matching to handle both hyphen and underscore separators.
 *
 * @param toolName - The tool name to check
 * @returns true if the tool name starts with "mcp--" or "mcp__", false otherwise
 */
export function isMcpTool(toolName: string): boolean {
	const normalized = normalizeForComparison(toolName)
	return normalized.startsWith(`${MCP_TOOL_PREFIX}__`)
}

/**
 * Sanitize a name to be safe for use in API function names.
 * This removes special characters and ensures the name starts correctly.
 *
 * Note: Hyphens are preserved since they are valid in function names.
 * Models may convert hyphens to underscores, but we handle this with
 * fuzzy matching when parsing tool names.
 *
 * @param name - The original name (e.g., MCP server name or tool name)
 * @returns A sanitized name that conforms to API requirements
 */
export function sanitizeMcpName(name: string): string {
	if (!name) {
		return "_"
	}

	// Replace spaces with underscores first
	let sanitized = name.replace(/\s+/g, "_")

	// Only allow alphanumeric, underscores, and hyphens
	sanitized = sanitized.replace(/[^a-zA-Z0-9_\-]/g, "")

	// Replace any double-hyphen sequences with single hyphen to avoid separator conflicts
	sanitized = sanitized.replace(/--+/g, "-")

	// Ensure the name starts with a letter or underscore
	if (sanitized.length > 0 && !/^[a-zA-Z_]/.test(sanitized)) {
		sanitized = "_" + sanitized
	}

	// If empty after sanitization, use a placeholder
	if (!sanitized) {
		sanitized = "_unnamed"
	}

	return sanitized
}

/**
 * Build a full MCP tool function name from server and tool names.
 * The format is: mcp--{sanitized_server_name}--{sanitized_tool_name}
 *
 * The total length is capped at 64 characters to conform to API limits. When the name is too
 * long, the *server* segment is shortened first: the original server name is recovered by lookup
 * (McpHub.findServerNameBySanitizedName), whereas the tool segment is handed straight back to the
 * MCP server by callTool() and has to survive intact. Blindly truncating the whole string chopped
 * the tool segment instead, so the model was handed a name like
 * "mcp--iogithubChromeDevToolschrome-devtools-mcp--performance_anal" and was then told that
 * "performance_anal" does not exist on the server.
 *
 * @param serverName - The MCP server name
 * @param toolName - The tool name
 * @returns A sanitized function name in the format mcp--serverName--toolName
 */
export function buildMcpToolName(serverName: string, toolName: string): string {
	const sanitizedServer = sanitizeMcpName(serverName)
	const sanitizedTool = sanitizeMcpName(toolName)

	const separatorOverhead = MCP_TOOL_PREFIX.length + MCP_TOOL_SEPARATOR.length * 2
	const build = (server: string, tool: string) =>
		`${MCP_TOOL_PREFIX}${MCP_TOOL_SEPARATOR}${server}${MCP_TOOL_SEPARATOR}${tool}`

	const fullName = build(sanitizedServer, sanitizedTool)
	if (fullName.length <= MCP_TOOL_NAME_MAX_LENGTH) {
		return fullName
	}

	// Over the limit: reclaim room from the server segment, then give the tool everything left.
	const serverSegment = buildMcpServerSegment(serverName)
	const toolBudget = MCP_TOOL_NAME_MAX_LENGTH - separatorOverhead - serverSegment.length

	return build(serverSegment, capSegment(sanitizedTool, toolBudget))
}

/**
 * Resolve the tool segment of a function name back to the server's actual tool name.
 *
 * Normally the segment is the tool name verbatim (or with hyphens mangled into underscores by the
 * model, which `toolNamesMatch` handles). For the rare tool name long enough that even a shortened
 * server segment leaves no room, the segment is a hashed short form, so fall back to rebuilding
 * each candidate's segment and comparing.
 *
 * @param serverName - The original (unsanitized) MCP server name
 * @param encodedToolSegment - The tool segment as it came back from the model
 * @param availableToolNames - The server's actual tool names
 * @returns The matching tool name, or null when nothing matches
 */
export function resolveMcpToolSegment(
	serverName: string,
	encodedToolSegment: string,
	availableToolNames: string[],
): string | null {
	const direct = availableToolNames.find((name) => toolNamesMatch(name, encodedToolSegment))
	if (direct) {
		return direct
	}

	const rebuilt = availableToolNames.find((name) => {
		const parsed = parseMcpToolName(buildMcpToolName(serverName, name))
		return parsed !== null && toolNamesMatch(parsed.toolName, encodedToolSegment)
	})

	return rebuilt ?? null
}

/**
 * Parse an MCP tool function name back into server and tool names.
 * This handles both hyphen and underscore separators using fuzzy matching.
 *
 * @param mcpToolName - The full MCP tool name (e.g., "mcp--weather--get_forecast" or "mcp__weather__get_forecast")
 * @returns An object with serverName and toolName, or null if parsing fails
 */
export function parseMcpToolName(mcpToolName: string): { serverName: string; toolName: string } | null {
	// Normalize the name to handle both separator styles
	const normalizedName = normalizeMcpToolName(mcpToolName)

	const prefix = MCP_TOOL_PREFIX + MCP_TOOL_SEPARATOR
	if (!normalizedName.startsWith(prefix)) {
		return null
	}

	// Remove the "mcp--" prefix
	const remainder = normalizedName.slice(prefix.length)

	// Split on the separator to get server and tool names
	const separatorIndex = remainder.indexOf(MCP_TOOL_SEPARATOR)
	if (separatorIndex === -1) {
		return null
	}

	const serverName = remainder.slice(0, separatorIndex)
	const toolName = remainder.slice(separatorIndex + MCP_TOOL_SEPARATOR.length)

	if (!serverName || !toolName) {
		return null
	}

	return {
		serverName,
		toolName,
	}
}

/**
 * Check if two tool names match using fuzzy comparison.
 * Treats hyphens and underscores as equivalent.
 *
 * @param name1 - First tool name
 * @param name2 - Second tool name
 * @returns true if the names match (treating - and _ as equivalent)
 */
export function toolNamesMatch(name1: string, name2: string): boolean {
	return normalizeForComparison(name1) === normalizeForComparison(name2)
}

/**
 * Find the single unambiguous near-miss for a requested tool name among a server's available
 * tools, for weak/local models that truncate or slightly misspell tool names (e.g.
 * "list_console_mes" instead of "list_console_messages") instead of retrying with the exact
 * name from the error's `available_tools` list.
 *
 * @param requestedName - The (unmatched) tool name the model called
 * @param availableNames - The server's actual tool names
 * @returns The single closest available name, or null if there's no confident, unambiguous match
 */
export function findClosestToolName(requestedName: string, availableNames: string[]): string | null {
	const normalizedRequested = normalizeForComparison(requestedName).toLowerCase()
	return findClosestMatch(normalizedRequested, availableNames, (name) => normalizeForComparison(name).toLowerCase())
}
