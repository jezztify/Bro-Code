// npx vitest core/webview/__tests__/ClineProvider.tierRouting.spec.ts

import * as vscode from "vscode"
import { TelemetryService } from "@bro-code/telemetry"
import { ClineProvider } from "../ClineProvider"
import { ContextProxy } from "../../config/ContextProxy"
import type { ProviderName } from "@bro-code/types"

vi.mock("vscode", () => ({
	ExtensionContext: vi.fn(),
	OutputChannel: vi.fn(),
	WebviewView: vi.fn(),
	Uri: {
		joinPath: vi.fn(),
		file: vi.fn(),
	},
	CodeActionKind: {
		QuickFix: { value: "quickfix" },
		RefactorRewrite: { value: "refactor.rewrite" },
	},
	commands: {
		executeCommand: vi.fn().mockResolvedValue(undefined),
	},
	window: {
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
	},
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn().mockReturnValue([]),
			update: vi.fn(),
		}),
		onDidChangeConfiguration: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
		onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
	},
	env: {
		uriScheme: "vscode",
		language: "en",
		appName: "Visual Studio Code",
	},
	ExtensionMode: {
		Production: 1,
		Development: 2,
		Test: 3,
	},
	version: "1.85.0",
}))

vi.mock("../../task/Task", () => ({
	Task: vi.fn().mockImplementation(function (options: any) {
		return {
			taskId: options.taskId || "test-task-id",
			saveClineMessages: vi.fn(),
			clineMessages: [],
			apiConversationHistory: [],
			overwriteClineMessages: vi.fn(),
			overwriteApiConversationHistory: vi.fn(),
			abortTask: vi.fn(),
			handleWebviewAskResponse: vi.fn(),
			getTaskNumber: vi.fn().mockReturnValue(0),
			setTaskNumber: vi.fn(),
			setParentTask: vi.fn(),
			setRootTask: vi.fn(),
			emit: vi.fn(),
			parentTask: options.parentTask,
			updateApiConfiguration: vi.fn(),
		}
	}),
}))

vi.mock("../../prompts/sections/custom-instructions")

vi.mock("../../../utils/safeWriteJson")

vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn().mockReturnValue({
		getModel: vi.fn().mockReturnValue({ id: "claude-3-sonnet" }),
	}),
}))

vi.mock("../../../integrations/workspace/WorkspaceTracker", () => ({
	default: vi.fn().mockImplementation(function () {
		return { initializeFilePaths: vi.fn(), dispose: vi.fn() }
	}),
}))

vi.mock("@bro-code/cloud", () => ({
	CloudService: {
		hasInstance: vi.fn().mockReturnValue(true),
		get instance() {
			return { isAuthenticated: vi.fn().mockReturnValue(false) }
		},
	},
	getBroCodeApiUrl: vi.fn().mockReturnValue("https://app.brocode.com"),
}))

vi.mock("p-wait-for", () => ({
	default: vi.fn().mockImplementation(async () => Promise.resolve()),
}))

vi.mock("fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockResolvedValue(""),
	readdir: vi.fn().mockResolvedValue([]),
	unlink: vi.fn().mockResolvedValue(undefined),
	rmdir: vi.fn().mockResolvedValue(undefined),
	access: vi.fn().mockResolvedValue(undefined),
	rm: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../../utils/storage", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../utils/storage")>()
	return {
		...actual,
		getStorageBasePath: vi.fn().mockImplementation((defaultPath: string) => defaultPath),
		getSettingsDirectoryPath: vi.fn().mockResolvedValue("/test/settings/path"),
		getTaskDirectoryPath: vi.fn().mockResolvedValue("/test/task/path"),
	}
})

vi.mock("@bro-code/telemetry", () => ({
	TelemetryService: {
		hasInstance: vi.fn().mockReturnValue(true),
		createInstance: vi.fn(),
		get instance() {
			return {
				trackEvent: vi.fn(),
				trackError: vi.fn(),
				setProvider: vi.fn(),
				captureModeSwitch: vi.fn(),
			}
		},
	},
}))

describe("ClineProvider - Tier Routing (Feature 2)", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext

	beforeEach(async () => {
		vi.clearAllMocks()

		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		const globalState: Record<string, any> = {
			mode: "code",
			currentApiConfigName: "test-config",
		}
		const secrets: Record<string, string | undefined> = {}

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: { fsPath: "/test/path" } as vscode.Uri,
			globalState: {
				get: vi.fn().mockImplementation((key: string) => globalState[key]),
				update: vi.fn().mockImplementation((key: string, value: any) => {
					globalState[key] = value
					return Promise.resolve()
				}),
				keys: vi.fn().mockImplementation(() => Object.keys(globalState)),
			},
			secrets: {
				get: vi.fn().mockImplementation((key: string) => secrets[key]),
				store: vi.fn().mockImplementation((key: string, value: string | undefined) => {
					secrets[key] = value
					return Promise.resolve()
				}),
				delete: vi.fn().mockImplementation((key: string) => {
					delete secrets[key]
					return Promise.resolve()
				}),
			},
			workspaceState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			subscriptions: [],
			extension: { packageJSON: { version: "1.0.0" } },
			globalStorageUri: { fsPath: "/test/storage/path" },
		} as unknown as vscode.ExtensionContext

		const mockOutputChannel = {
			appendLine: vi.fn(),
			clear: vi.fn(),
			dispose: vi.fn(),
		} as unknown as vscode.OutputChannel

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))

		// Wait for the async TaskHistoryStore initialization to complete.
		await new Promise((resolve) => setTimeout(resolve, 10))
	})

	it("is a no-op when no tier is given", async () => {
		const activateSpy = vi.spyOn(provider, "activateProviderProfile").mockResolvedValue(undefined as any)
		await provider.activateTierProfileIfConfigured(undefined)
		expect(activateSpy).not.toHaveBeenCalled()
	})

	it("is a no-op when the tier has no mapping configured", async () => {
		await provider.setValue("tierApiConfigs" as any, {})
		const activateSpy = vi.spyOn(provider, "activateProviderProfile").mockResolvedValue(undefined as any)
		await provider.activateTierProfileIfConfigured("hard")
		expect(activateSpy).not.toHaveBeenCalled()
	})

	it("activates the mapped profile when the tier resolves to a configured profile", async () => {
		const hardConfig = { apiProvider: "anthropic" as ProviderName, anthropicApiKey: "hard-key" }
		await provider.upsertProviderProfile("hard-config", hardConfig)
		const hardConfigId = provider.getProviderProfileEntry("hard-config")?.id

		await provider.setValue("tierApiConfigs" as any, { hard: hardConfigId })

		const activateSpy = vi.spyOn(provider, "activateProviderProfile").mockResolvedValue(undefined as any)
		await provider.activateTierProfileIfConfigured("hard")

		expect(activateSpy).toHaveBeenCalledWith({ name: "hard-config" })
	})

	it("does not activate an unconfigured (empty) profile mapped to a tier", async () => {
		// Simulate a profile that exists in listConfig but has no apiProvider set yet.
		vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
			{ id: "empty-id", name: "empty-profile" } as any,
		])
		vi.spyOn(provider.providerSettingsManager, "getProfile").mockResolvedValue({} as any)

		await provider.setValue("tierApiConfigs" as any, { trivial: "empty-id" })

		const activateSpy = vi.spyOn(provider, "activateProviderProfile").mockResolvedValue(undefined as any)
		await provider.activateTierProfileIfConfigured("trivial")

		expect(activateSpy).not.toHaveBeenCalled()
	})

	it("delegateParentAndOpenChild applies tier routing after the mode-based config resolution", async () => {
		const handleModeSwitchSpy = vi.spyOn(provider, "handleModeSwitch").mockResolvedValue(undefined)
		const activateTierSpy = vi
			.spyOn(provider, "activateTierProfileIfConfigured")
			.mockResolvedValue(undefined as any)

		const parent = {
			taskId: "parent-1",
			flushPendingToolResultsToHistory: vi.fn().mockResolvedValue(true),
		}
		vi.spyOn(provider, "getCurrentTask").mockReturnValue(parent as any)
		vi.spyOn(provider as any, "removeClineFromStack").mockResolvedValue(undefined)
		vi.spyOn(provider, "createTask").mockResolvedValue({ taskId: "child-1", start: vi.fn() } as any)
		vi.spyOn(provider, "postMessageToWebview").mockResolvedValue(undefined)
		vi.spyOn(provider as any, "postStateToWebviewWithoutTaskHistory").mockResolvedValue(undefined)
		vi.spyOn(provider, "getTaskWithId").mockResolvedValue({
			historyItem: { id: "parent-1", childIds: [] },
		} as any)
		vi.spyOn(provider as any, "updateTaskHistory").mockResolvedValue([])

		await provider.delegateParentAndOpenChild({
			parentTaskId: "parent-1",
			message: "do the thing",
			initialTodos: [],
			mode: "code",
			tier: "trivial",
		})

		expect(handleModeSwitchSpy).toHaveBeenCalledWith("code")
		expect(activateTierSpy).toHaveBeenCalledWith("trivial")
		// Tier resolution must run after mode resolution so it can override the mode's sticky config.
		const modeCallOrder = handleModeSwitchSpy.mock.invocationCallOrder[0]
		const tierCallOrder = activateTierSpy.mock.invocationCallOrder[0]
		expect(tierCallOrder).toBeGreaterThan(modeCallOrder)
	})
})
