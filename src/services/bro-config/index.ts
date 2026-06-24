import * as path from "path"
import * as os from "os"
import fs from "fs/promises"

/**
 * Gets the global .bro directory path based on the current platform
 *
 * @returns The absolute path to the global .bro directory
 *
 * @example Platform-specific paths:
 * ```
 * // macOS/Linux: ~/.bro/
 * // Example: /Users/john/.bro
 *
 * // Windows: %USERPROFILE%\.bro\
 * // Example: C:\Users\john\.bro
 * ```
 *
 * @example Usage:
 * ```typescript
 * const globalDir = getGlobalBroDirectory()
 * // Returns: "/Users/john/.bro" (on macOS/Linux)
 * // Returns: "C:\\Users\\john\\.bro" (on Windows)
 * ```
 */
export function getGlobalBroDirectory(): string {
	const homeDir = os.homedir()
	return path.join(homeDir, ".bro")
}

/**
 * Gets the global .agents directory path based on the current platform.
 * This is a shared directory for agent skills across different AI coding tools.
 *
 * @returns The absolute path to the global .agents directory
 *
 * @example Platform-specific paths:
 * ```
 * // macOS/Linux: ~/.agents/
 * // Example: /Users/john/.agents
 *
 * // Windows: %USERPROFILE%\.agents\
 * // Example: C:\Users\john\.agents
 * ```
 *
 * @example Usage:
 * ```typescript
 * const globalAgentsDir = getGlobalAgentsDirectory()
 * // Returns: "/Users/john/.agents" (on macOS/Linux)
 * // Returns: "C:\\Users\\john\\.agents" (on Windows)
 * ```
 */
export function getGlobalAgentsDirectory(): string {
	const homeDir = os.homedir()
	return path.join(homeDir, ".agents")
}

/**
 * Gets the project-local .agents directory path for a given cwd.
 * This is a shared directory for agent skills across different AI coding tools.
 *
 * @param cwd - Current working directory (project path)
 * @returns The absolute path to the project-local .agents directory
 *
 * @example
 * ```typescript
 * const projectAgentsDir = getProjectAgentsDirectoryForCwd('/Users/john/my-project')
 * // Returns: "/Users/john/my-project/.agents"
 * ```
 */
export function getProjectAgentsDirectoryForCwd(cwd: string): string {
	return path.join(cwd, ".agents")
}

/**
 * Gets the project-local .bro directory path for a given cwd
 *
 * @param cwd - Current working directory (project path)
 * @returns The absolute path to the project-local .bro directory
 *
 * @example
 * ```typescript
 * const projectDir = getProjectBroDirectoryForCwd('/Users/john/my-project')
 * // Returns: "/Users/john/my-project/.bro"
 *
 * const windowsProjectDir = getProjectBroDirectoryForCwd('C:\\Users\\john\\my-project')
 * // Returns: "C:\\Users\\john\\my-project\\.bro"
 * ```
 *
 * @example Directory structure:
 * ```
 * /Users/john/my-project/
 * ├── .bro/                    # Project-local configuration directory
 * │   ├── rules/
 * │   │   └── rules.md
 * │   ├── custom-instructions.md
 * │   └── config/
 * │       └── settings.json
 * ├── src/
 * │   └── index.ts
 * └── package.json
 * ```
 */
export function getProjectBroDirectoryForCwd(cwd: string): string {
	return path.join(cwd, ".bro")
}

/**
 * Checks if a directory exists
 */
export async function directoryExists(dirPath: string): Promise<boolean> {
	try {
		const stat = await fs.stat(dirPath)
		return stat.isDirectory()
	} catch (error: any) {
		// Only catch expected "not found" errors
		if (error.code === "ENOENT" || error.code === "ENOTDIR") {
			return false
		}
		// Re-throw unexpected errors (permission, I/O, etc.)
		throw error
	}
}

/**
 * Checks if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
	try {
		const stat = await fs.stat(filePath)
		return stat.isFile()
	} catch (error: any) {
		// Only catch expected "not found" errors
		if (error.code === "ENOENT" || error.code === "ENOTDIR") {
			return false
		}
		// Re-throw unexpected errors (permission, I/O, etc.)
		throw error
	}
}

/**
 * Reads a file safely, returning null if it doesn't exist
 */
export async function readFileIfExists(filePath: string): Promise<string | null> {
	try {
		return await fs.readFile(filePath, "utf-8")
	} catch (error: any) {
		// Only catch expected "not found" errors
		if (error.code === "ENOENT" || error.code === "ENOTDIR" || error.code === "EISDIR") {
			return null
		}
		// Re-throw unexpected errors (permission, I/O, etc.)
		throw error
	}
}

/**
 * Discovers all .bro directories in subdirectories of the workspace
 *
 * @param cwd - Current working directory (workspace root)
 * @returns Array of absolute paths to .bro directories found in subdirectories,
 *          sorted alphabetically. Does not include the root .bro directory.
 *
 * @example
 * ```typescript
 * const subfolderBros = await discoverSubfolderBroDirectories('/Users/john/monorepo')
 * // Returns:
 * // [
 * //   '/Users/john/monorepo/package-a/.bro',
 * //   '/Users/john/monorepo/package-b/.bro',
 * //   '/Users/john/monorepo/packages/shared/.bro'
 * // ]
 * ```
 *
 * @example Directory structure:
 * ```
 * /Users/john/monorepo/
 * ├── .bro/                    # Root .bro (NOT included - use getProjectBroDirectoryForCwd)
 * ├── package-a/
 * │   └── .bro/                # Included
 * │       └── rules/
 * ├── package-b/
 * │   └── .bro/                # Included
 * │       └── rules-code/
 * └── packages/
 *     └── shared/
 *         └── .bro/            # Included (nested)
 *             └── rules/
 * ```
 */
export async function discoverSubfolderBroDirectories(cwd: string): Promise<string[]> {
	try {
		// Dynamic import to avoid vscode dependency at module load time
		// This is necessary because file-search.ts imports vscode, which is not
		// available in the webview context
		const { executeRipgrep } = await import("../search/file-search")

		// Use ripgrep to find any file inside any .bro directory
		// This efficiently discovers all .bro folders regardless of their content
		const args = [
			"--files",
			"--hidden",
			"--follow",
			"-g",
			"**/.bro/**",
			"-g",
			"!node_modules/**",
			"-g",
			"!.git/**",
			cwd,
		]

		const results = await executeRipgrep({ args, workspacePath: cwd })

		// Extract unique .bro directory paths
		const broDirs = new Set<string>()
		const rootBroDir = path.join(cwd, ".bro")

		for (const result of results) {
			// Match paths like "subfolder/.bro/anything" or "subfolder/nested/.bro/anything"
			// Handle both forward slashes (Unix) and backslashes (Windows)
			const match = result.path.match(/^(.+?)[/\\]\.bro[/\\]/)
			if (match) {
				const broDir = path.join(cwd, match[1], ".bro")
				// Exclude the root .bro directory (already handled by getProjectBroDirectoryForCwd)
				if (broDir !== rootBroDir) {
					broDirs.add(broDir)
				}
			}
		}

		// Return sorted alphabetically
		return Array.from(broDirs).sort()
	} catch (error) {
		// If discovery fails (e.g., ripgrep not available), return empty array
		return []
	}
}

/**
 * Gets the ordered list of .bro directories to check (global first, then project-local)
 *
 * @param cwd - Current working directory (project path)
 * @returns Array of directory paths to check in order [global, project-local]
 *
 * @example
 * ```typescript
 * // For a project at /Users/john/my-project
 * const directories = getBroDirectoriesForCwd('/Users/john/my-project')
 * // Returns:
 * // [
 * //   '/Users/john/.bro',           // Global directory
 * //   '/Users/john/my-project/.bro' // Project-local directory
 * // ]
 * ```
 *
 * @example Directory structure:
 * ```
 * /Users/john/
 * ├── .bro/                    # Global configuration
 * │   ├── rules/
 * │   │   └── rules.md
 * │   └── custom-instructions.md
 * └── my-project/
 *     ├── .bro/                # Project-specific configuration
 *     │   ├── rules/
 *     │   │   └── rules.md     # Overrides global rules
 *     │   └── project-notes.md
 *     └── src/
 *         └── index.ts
 * ```
 */
export function getBroDirectoriesForCwd(cwd: string): string[] {
	const directories: string[] = []

	// Add global directory first
	directories.push(getGlobalBroDirectory())

	// Add project-local directory second
	directories.push(getProjectBroDirectoryForCwd(cwd))

	return directories
}

/**
 * Gets the ordered list of all .bro directories including subdirectories
 *
 * @param cwd - Current working directory (project path)
 * @returns Array of directory paths in order: [global, project-local, ...subfolders (alphabetically)]
 *
 * @example
 * ```typescript
 * // For a monorepo at /Users/john/monorepo with .bro in subfolders
 * const directories = await getAllBroDirectoriesForCwd('/Users/john/monorepo')
 * // Returns:
 * // [
 * //   '/Users/john/.bro',                    // Global directory
 * //   '/Users/john/monorepo/.bro',           // Project-local directory
 * //   '/Users/john/monorepo/package-a/.bro', // Subfolder (alphabetical)
 * //   '/Users/john/monorepo/package-b/.bro'  // Subfolder (alphabetical)
 * // ]
 * ```
 */
export async function getAllBroDirectoriesForCwd(cwd: string): Promise<string[]> {
	const directories: string[] = []

	// Add global directory first
	directories.push(getGlobalBroDirectory())

	// Add project-local directory second
	directories.push(getProjectBroDirectoryForCwd(cwd))

	// Discover and add subfolder .bro directories
	const subfolderDirs = await discoverSubfolderBroDirectories(cwd)
	directories.push(...subfolderDirs)

	return directories
}

/**
 * Gets parent directories containing .bro folders, in order from root to subfolders
 *
 * @param cwd - Current working directory (project path)
 * @returns Array of parent directory paths (not .bro paths) containing AGENTS.md or .bro
 *
 * @example
 * ```typescript
 * const dirs = await getAgentsDirectoriesForCwd('/Users/john/monorepo')
 * // Returns: ['/Users/john/monorepo', '/Users/john/monorepo/package-a', ...]
 * ```
 */
export async function getAgentsDirectoriesForCwd(cwd: string): Promise<string[]> {
	const directories: string[] = []

	// Always include the root directory
	directories.push(cwd)

	// Get all subfolder .bro directories
	const subfolderBroDirs = await discoverSubfolderBroDirectories(cwd)

	// Extract parent directories (remove .bro from path)
	for (const broDir of subfolderBroDirs) {
		const parentDir = path.dirname(broDir)
		directories.push(parentDir)
	}

	return directories
}

/**
 * Loads configuration from multiple .bro directories with project overriding global
 *
 * @param relativePath - The relative path within each .bro directory (e.g., 'rules/rules.md')
 * @param cwd - Current working directory (project path)
 * @returns Object with global and project content, plus merged content
 *
 * @example
 * ```typescript
 * // Load rules configuration for a project
 * const config = await loadConfiguration('rules/rules.md', '/Users/john/my-project')
 *
 * // Returns:
 * // {
 * //   global: "Global rules content...",     // From ~/.bro/rules/rules.md
 * //   project: "Project rules content...",   // From /Users/john/my-project/.bro/rules/rules.md
 * //   merged: "Global rules content...\n\n# Project-specific rules (override global):\n\nProject rules content..."
 * // }
 * ```
 *
 * @example File paths resolved:
 * ```
 * relativePath: 'rules/rules.md'
 * cwd: '/Users/john/my-project'
 *
 * Reads from:
 * - Global: /Users/john/.bro/rules/rules.md
 * - Project: /Users/john/my-project/.bro/rules/rules.md
 *
 * Other common relativePath examples:
 * - 'custom-instructions.md'
 * - 'config/settings.json'
 * - 'templates/component.tsx'
 * ```
 *
 * @example Merging behavior:
 * ```
 * // If only global exists:
 * { global: "content", project: null, merged: "content" }
 *
 * // If only project exists:
 * { global: null, project: "content", merged: "content" }
 *
 * // If both exist:
 * {
 *   global: "global content",
 *   project: "project content",
 *   merged: "global content\n\n# Project-specific rules (override global):\n\nproject content"
 * }
 * ```
 */
export async function loadConfiguration(
	relativePath: string,
	cwd: string,
): Promise<{
	global: string | null
	project: string | null
	merged: string
}> {
	const globalDir = getGlobalBroDirectory()
	const projectDir = getProjectBroDirectoryForCwd(cwd)

	const globalFilePath = path.join(globalDir, relativePath)
	const projectFilePath = path.join(projectDir, relativePath)

	// Read global configuration
	const globalContent = await readFileIfExists(globalFilePath)

	// Read project-local configuration
	const projectContent = await readFileIfExists(projectFilePath)

	// Merge configurations - project overrides global
	let merged = ""

	if (globalContent) {
		merged += globalContent
	}

	if (projectContent) {
		if (merged) {
			merged += "\n\n# Project-specific rules (override global):\n\n"
		}
		merged += projectContent
	}

	return {
		global: globalContent,
		project: projectContent,
		merged: merged || "",
	}
}

// Export with backward compatibility alias
export const loadBroConfiguration: typeof loadConfiguration = loadConfiguration
