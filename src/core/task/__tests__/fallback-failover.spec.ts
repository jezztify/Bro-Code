// npx vitest core/task/__tests__/fallback-failover.spec.ts

import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

import type { GlobalState, ProviderSettings } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { ContextProxy } from "../../config/ContextProxy"

// Mock @roo-code/core
vi.mock("@roo-code/core", () => ({
	customToolRegistry: {
		getTools: vi.fn().mockReturnValue([]),
		hasTool: vi.fn().mockReturnValue(false),
		getTool: vi.fn().mockReturnValue(undefined),
	},
}))

vi.mock("delay", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

vi.mock("fs/promises", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, any>
	const mockFunctions = {
		mkdir: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
		readFile: vi.fn().mockImplementation(() => Promise.resolve("[]")),
		unlink: vi.fn().mockResolvedValue(undefined),
		rmdir: vi.fn().mockResolvedValue(undefined),
	}

	return {
		...actual,
		...mockFunctions,
		default: mockFunctions,
	}
})

vi.mock("p-wait-for", () => ({
	default: vi.fn().mockImplementation(async () => Promise.resolve()),
}))

vi.mock("vscode", () => {
	const mockDisposable = { dispose: vi.fn() }
	const mockEventEmitter = { event: vi.fn(), fire: vi.fn() }
	const mockTextDocument = { uri: { fsPath: "/mock/workspace/path/file.ts" } }
	const mockTextEditor = { document: mockTextDocument }
	const mockTab = { input: { uri: { fsPath: "/mock/workspace/path/file.ts" } } }
	const mockTabGroup = { tabs: [mockTab] }

	return {
		TabInputTextDiff: vi.fn(),
		CodeActionKind: {
			QuickFix: { value: "quickfix" },
			RefactorRewrite: { value: "refactor.rewrite" },
		},
		window: {
			createTextEditorDecorationType: vi.fn().mockReturnValue({
				dispose: vi.fn(),
			}),
			visibleTextEditors: [mockTextEditor],
			tabGroups: {
				all: [mockTabGroup],
				close: vi.fn(),
				onDidChangeTabs: vi.fn(() => ({ dispose: vi.fn() })),
			},
			showErrorMessage: vi.fn(),
		},
		workspace: {
			workspaceFolders: [
				{
					uri: { fsPath: "/mock/workspace/path" },
					name: "mock-workspace",
					index: 0,
				},
			],
			createFileSystemWatcher: vi.fn(() => ({
				onDidCreate: vi.fn(() => mockDisposable),
				onDidDelete: vi.fn(() => mockDisposable),
				onDidChange: vi.fn(() => mockDisposable),
				dispose: vi.fn(),
			})),
			fs: {
				stat: vi.fn().mockResolvedValue({ type: 1 }),
			},
			onDidSaveTextDocument: vi.fn(() => mockDisposable),
			getConfiguration: vi.fn(() => ({ get: (key: string, defaultValue: any) => defaultValue })),
		},
		env: {
			uriScheme: "vscode",
			language: "en",
		},
		EventEmitter: vi.fn().mockImplementation(function () {
			return mockEventEmitter
		}),
		Disposable: {
			from: vi.fn(),
		},
		TabInputText: vi.fn(),
	}
})

vi.mock("../../mentions", () => ({
	parseMentions: vi.fn().mockImplementation((text) => {
		return Promise.resolve({ text: `processed: ${text}`, mode: undefined, contentBlocks: [] })
	}),
	openMention: vi.fn(),
	getLatestTerminalOutput: vi.fn(),
}))

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockResolvedValue("Mock file content"),
}))

vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue(""),
}))

vi.mock("../../ignore/RooIgnoreController")

vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath, taskId) => Promise.resolve(`${globalStoragePath}/tasks/${taskId}`)),
	getSettingsDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath) => Promise.resolve(`${globalStoragePath}/settings`)),
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockImplementation(() => false),
}))

describe("Task - per-mode fallback API provider failover", () => {
	let mockProvider: any
	let mockApiConfig: ProviderSettings

	beforeEach(() => {
		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		const storageUri = { fsPath: path.join(os.tmpdir(), "test-storage") }

		const mockExtensionContext = {
			globalState: {
				get: vi.fn().mockImplementation((_key: keyof GlobalState) => undefined),
				update: vi.fn().mockImplementation((_key, _value) => Promise.resolve()),
				keys: vi.fn().mockReturnValue([]),
			},
			globalStorageUri: storageUri,
			workspaceState: {
				get: vi.fn().mockImplementation((_key) => undefined),
				update: vi.fn().mockImplementation((_key, _value) => Promise.resolve()),
				keys: vi.fn().mockReturnValue([]),
			},
			secrets: {
				get: vi.fn().mockImplementation((_key) => Promise.resolve(undefined)),
				store: vi.fn().mockImplementation((_key, _value) => Promise.resolve()),
				delete: vi.fn().mockImplementation((_key) => Promise.resolve()),
			},
			extensionUri: { fsPath: "/mock/extension/path" },
			extension: { packageJSON: { version: "1.0.0" } },
		} as unknown as vscode.ExtensionContext

		const mockOutputChannel = {
			appendLine: vi.fn(),
			append: vi.fn(),
			clear: vi.fn(),
			show: vi.fn(),
			hide: vi.fn(),
			dispose: vi.fn(),
		}

		mockProvider = new ClineProvider(
			mockExtensionContext,
			mockOutputChannel as any,
			"sidebar",
			new ContextProxy(mockExtensionContext),
		) as any

		mockApiConfig = {
			apiProvider: "anthropic",
			apiModelId: "claude-3-5-sonnet-20241022",
			apiKey: "test-api-key",
		}

		mockProvider.postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.postStateToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.postStateToWebviewWithoutTaskHistory = vi.fn().mockResolvedValue(undefined)
		mockProvider.log = vi.fn()
		mockProvider.activateProviderProfile = vi.fn().mockResolvedValue(undefined)
		mockProvider.providerSettingsManager = {
			getProfile: vi.fn(),
		}
	})

	// Fallbacks are configured per mode and looked up against the *task's* mode, not
	// the mode on the state object passed in. mockProvider is a real ClineProvider, so
	// without pinning this the task would inherit whatever mode ambient state happens
	// to carry and never match the custom mode these tests define.
	const createTask = (initialMode = "code") =>
		new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "test task",
			startTask: false,
			initialMode,
		})

	describe("tryFailoverToNextProfile", () => {
		it("returns false when the mode has no fallbackApiConfigIds configured", async () => {
			const task = createTask()

			const state = {
				mode: "code",
				customModes: [],
				listApiConfigMeta: [],
				maxFallbacksPerMode: 5,
			} as any

			const result = await (task as any).tryFailoverToNextProfile(state)

			expect(result).toBe(false)
			expect(mockProvider.activateProviderProfile).not.toHaveBeenCalled()
		})

		it("activates the first untried fallback profile and announces the switch", async () => {
			const task = createTask()
			task.setTaskApiConfigName("primary-profile")

			mockProvider.providerSettingsManager.getProfile.mockResolvedValue({
				name: "backup-profile",
				id: "backup-id",
				apiProvider: "openai",
			})

			const sayMock = vi.spyOn(task, "say").mockResolvedValue(undefined)
			const updateApiConfigurationMock = vi.spyOn(task, "updateApiConfiguration").mockImplementation(() => {})

			const state = {
				mode: "code",
				customModes: [
					{
						slug: "code",
						name: "Code",
						roleDefinition: "x",
						groups: [],
						fallbackApiConfigIds: ["backup-id"],
					},
				],
				listApiConfigMeta: [{ id: "backup-id", name: "backup-profile" }],
				maxFallbacksPerMode: 5,
			} as any

			const result = await (task as any).tryFailoverToNextProfile(state)

			expect(result).toBe(true)
			expect(mockProvider.activateProviderProfile).toHaveBeenCalledWith({ id: "backup-id" })
			expect(updateApiConfigurationMock).toHaveBeenCalledWith(expect.objectContaining({ apiProvider: "openai" }))
			expect(sayMock).toHaveBeenCalledWith("api_req_retried", expect.stringContaining("backup-profile"))
		})

		it("does not retry a fallback id already attempted in this logical request", async () => {
			const task = createTask()
			;(task as any).attemptedFallbackApiConfigIds.add("backup-id")

			const state = {
				mode: "code",
				customModes: [
					{
						slug: "code",
						name: "Code",
						roleDefinition: "x",
						groups: [],
						fallbackApiConfigIds: ["backup-id"],
					},
				],
				listApiConfigMeta: [{ id: "backup-id", name: "backup-profile" }],
				maxFallbacksPerMode: 5,
			} as any

			const result = await (task as any).tryFailoverToNextProfile(state)

			expect(result).toBe(false)
			expect(mockProvider.activateProviderProfile).not.toHaveBeenCalled()
		})

		it("skips a fallback id that no longer references an existing profile", async () => {
			const task = createTask()

			mockProvider.providerSettingsManager.getProfile.mockResolvedValue({
				name: "second-profile",
				id: "second-id",
				apiProvider: "openai",
			})

			const state = {
				mode: "code",
				customModes: [
					{
						slug: "code",
						name: "Code",
						roleDefinition: "x",
						groups: [],
						fallbackApiConfigIds: ["stale-id", "second-id"],
					},
				],
				// Only "second-id" still exists among configured profiles.
				listApiConfigMeta: [{ id: "second-id", name: "second-profile" }],
				maxFallbacksPerMode: 5,
			} as any

			const result = await (task as any).tryFailoverToNextProfile(state)

			expect(result).toBe(true)
			expect(mockProvider.activateProviderProfile).toHaveBeenCalledWith({ id: "second-id" })
			expect(mockProvider.activateProviderProfile).toHaveBeenCalledTimes(1)
		})

		it("honors maxFallbacksPerMode even when the mode config lists more fallbacks", async () => {
			const task = createTask()

			const state = {
				mode: "code",
				customModes: [
					{
						slug: "code",
						name: "Code",
						roleDefinition: "x",
						groups: [],
						fallbackApiConfigIds: ["id-1", "id-2", "id-3"],
					},
				],
				listApiConfigMeta: [
					{ id: "id-1", name: "one" },
					{ id: "id-2", name: "two" },
					{ id: "id-3", name: "three" },
				],
				maxFallbacksPerMode: 0,
			} as any

			const result = await (task as any).tryFailoverToNextProfile(state)

			expect(result).toBe(false)
			expect(mockProvider.activateProviderProfile).not.toHaveBeenCalled()
		})

		it("returns false and does not throw when every fallback is exhausted", async () => {
			const task = createTask()
			;(task as any).attemptedFallbackApiConfigIds.add("id-1")
			;(task as any).attemptedFallbackApiConfigIds.add("id-2")

			const state = {
				mode: "code",
				customModes: [
					{
						slug: "code",
						name: "Code",
						roleDefinition: "x",
						groups: [],
						fallbackApiConfigIds: ["id-1", "id-2"],
					},
				],
				listApiConfigMeta: [
					{ id: "id-1", name: "one" },
					{ id: "id-2", name: "two" },
				],
				maxFallbacksPerMode: 5,
			} as any

			const result = await (task as any).tryFailoverToNextProfile(state)

			expect(result).toBe(false)
		})
	})
})
