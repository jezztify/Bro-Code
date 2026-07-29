import type OpenAI from "openai"
import accessMcpResource from "./access_mcp_resource"
import { apply_diff } from "./apply_diff"
import applyPatch from "./apply_patch"
import askFollowupQuestion from "./ask_followup_question"
import attemptCompletion from "./attempt_completion"
import codebaseSearch from "./codebase_search"
import createBoardTask from "./create_board_task"
import deleteBoardTask from "./delete_board_task"
import editTool from "./edit"
import executeCommand from "./execute_command"
import generateImage from "./generate_image"
import listFiles from "./list_files"
import { createNewTaskTool, type NewTaskToolOptions } from "./new_task"
import readCommandOutput from "./read_command_output"
import readBoardTask from "./read_board_task"
import { createReadFileTool, type ReadFileToolOptions } from "./read_file"
import runSlashCommand from "./run_slash_command"
import skill from "./skill"
import searchReplace from "./search_replace"
import edit_file from "./edit_file"
import searchFiles from "./search_files"
import switchMode from "./switch_mode"
import updateTodoList from "./update_todo_list"
import updateBoardTask from "./update_board_task"
import writeToFile from "./write_to_file"

export { getMcpServerTools } from "./mcp_server"
export { convertOpenAIToolToAnthropic, convertOpenAIToolsToAnthropic } from "./converters"
export type { ReadFileToolOptions } from "./read_file"
export type { NewTaskToolOptions } from "./new_task"

/**
 * Options for customizing the native tools array.
 */
export interface NativeToolsOptions {
	/** Whether the model supports image processing (default: false) */
	supportsImages?: boolean
	/** Whether new_task mandates an initial todo list (default: false) */
	requireTodos?: boolean
}

/**
 * Get native tools array, optionally customizing based on settings.
 *
 * @param options - Configuration options for the tools
 * @returns Array of native tool definitions
 */
export function getNativeTools(options: NativeToolsOptions = {}): OpenAI.Chat.ChatCompletionTool[] {
	const { supportsImages = false, requireTodos = false } = options

	const readFileOptions: ReadFileToolOptions = {
		supportsImages,
	}

	const newTaskOptions: NewTaskToolOptions = {
		requireTodos,
	}

	return [
		accessMcpResource,
		apply_diff,
		applyPatch,
		askFollowupQuestion,
		attemptCompletion,
		codebaseSearch,
		createBoardTask,
		deleteBoardTask,
		executeCommand,
		generateImage,
		listFiles,
		createNewTaskTool(newTaskOptions),
		readCommandOutput,
		readBoardTask,
		createReadFileTool(readFileOptions),
		runSlashCommand,
		skill,
		searchReplace,
		edit_file,
		editTool,
		searchFiles,
		switchMode,
		updateTodoList,
		updateBoardTask,
		writeToFile,
	] satisfies OpenAI.Chat.ChatCompletionTool[]
}

// Backward compatibility: export default tools with line ranges enabled
export const nativeTools = getNativeTools()
