// npx vitest run core/webview/__tests__/ClineProvider.tierApiConfig.spec.ts

import * as vscode from "vscode"
import { TelemetryService } from "@roo-code/telemetry"
import { ClineProvider } from "../ClineProvider"
import { ContextProxy } from "../../config/ContextProxy"

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
		onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
		onDidChangeConfiguration: vi.fn().mockImplementation(() => {
			return {
				dispose: vi.fn(),
			}
		}),
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
	Task: vi.fn().mockImplementation(function (options) {
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
			setTaskApiConfigName: vi.fn(),
			_taskApiConfigName: options.historyItem?.apiConfigName,
			taskApiConfigName: options.historyItem?.apiConfigName,
		}
	}),
}))

vi.mock("../../prompts/sections/custom-instructions")

vi.mock("../../../utils/safeWriteJson")

vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn().mockReturnValue({
		getModel: vi.fn().mockReturnValue({
			id: "claude-3-sonnet",
		}),
	}),
}))

vi.mock("../../../integrations/workspace/WorkspaceTracker", () => ({
	default: vi.fn().mockImplementation(function () {
		return {
			initializeFilePaths: vi.fn(),
			dispose: vi.fn(),
		}
	}),
}))

vi.mock("../../diff/strategies/multi-search-replace", () => ({
	MultiSearchReplaceDiffStrategy: vi.fn().mockImplementation(function () {
		return {
			getName: () => "test-strategy",
			applyDiff: vi.fn(),
		}
	}),
}))

vi.mock("@roo-code/cloud", () => ({
	CloudService: {
		hasInstance: vi.fn().mockReturnValue(true),
		get instance() {
			return {
				isAuthenticated: vi.fn().mockReturnValue(false),
			}
		},
	},
	getRooCodeApiUrl: vi.fn().mockReturnValue("https://app.roocode.com"),
}))

vi.mock("../../../shared/modes", () => {
	const mockModes = [
		{
			slug: "code",
			name: "Code Mode",
			roleDefinition: "You are a code assistant",
			groups: ["read", "edit"],
		},
	]

	return {
		modes: mockModes,
		getAllModes: vi.fn(() => [...mockModes]),
		getModeBySlug: vi.fn().mockReturnValue(mockModes[0]),
		defaultModeSlug: "code",
	}
})

vi.mock("../../prompts/system", () => ({
	SYSTEM_PROMPT: vi.fn().mockResolvedValue("mocked system prompt"),
	codeMode: "code",
}))

vi.mock("../../../api/providers/fetchers/modelCache", () => ({
	getModels: vi.fn().mockResolvedValue({}),
	flushModels: vi.fn(),
}))

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockResolvedValue("Mock file content"),
}))

vi.mock("p-wait-for", () => ({
	default: vi.fn().mockImplementation(async () => Promise.resolve()),
}))

vi.mock("fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockResolvedValue(""),
	unlink: vi.fn().mockResolvedValue(undefined),
	rmdir: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@roo-code/telemetry", () => ({
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

describe("ClineProvider - activateTierProfileIfConfigured", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext

	beforeEach(() => {
		vi.clearAllMocks()

		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		const globalState: Record<string, unknown> = {
			mode: "code",
			currentApiConfigName: "default-profile",
		}

		const workspaceState: Record<string, unknown> = {}
		const secrets: Record<string, string | undefined> = {}

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: { fsPath: "/test/path" } as vscode.Uri,
			globalState: {
				get: vi.fn().mockImplementation((key: string) => globalState[key]),
				update: vi.fn().mockImplementation((key: string, value: unknown) => {
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
				get: vi.fn().mockImplementation((key: string, defaultValue?: unknown) => {
					return key in workspaceState ? workspaceState[key] : defaultValue
				}),
				update: vi.fn().mockImplementation((key: string, value: unknown) => {
					workspaceState[key] = value
					return Promise.resolve()
				}),
				keys: vi.fn().mockImplementation(() => Object.keys(workspaceState)),
			},
			subscriptions: [],
			extension: {
				packageJSON: { version: "1.0.0" },
			},
			globalStorageUri: {
				fsPath: "/test/storage/path",
			},
		} as unknown as vscode.ExtensionContext

		provider = new ClineProvider(
			mockContext,
			{ appendLine: vi.fn(), clear: vi.fn(), dispose: vi.fn() } as unknown as vscode.OutputChannel,
			"sidebar",
			new ContextProxy(mockContext),
		)
	})

	it("is a no-op when no tier is given", async () => {
		const activateProviderProfileSpy = vi.spyOn(provider, "activateProviderProfile").mockResolvedValue(undefined)

		await provider.activateTierProfileIfConfigured(undefined)

		expect(activateProviderProfileSpy).not.toHaveBeenCalled()
	})

	it("is a no-op when the given tier has no mapped profile", async () => {
		await provider.contextProxy.setValue("tierApiConfigs", { hard: "hard-profile-id" })
		const activateProviderProfileSpy = vi.spyOn(provider, "activateProviderProfile").mockResolvedValue(undefined)

		await provider.activateTierProfileIfConfigured("trivial")

		expect(activateProviderProfileSpy).not.toHaveBeenCalled()
	})

	it("activates the tier's mapped profile when configured", async () => {
		await provider.contextProxy.setValue("tierApiConfigs", { hard: "hard-profile-id" })

		vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
			{ name: "hard-profile", id: "hard-profile-id", apiProvider: "anthropic" },
		])
		vi.spyOn(provider.providerSettingsManager, "getProfile").mockResolvedValue({
			name: "hard-profile",
			apiProvider: "anthropic",
		} as any)
		const activateProviderProfileSpy = vi.spyOn(provider, "activateProviderProfile").mockResolvedValue(undefined)

		await provider.activateTierProfileIfConfigured("hard")

		expect(activateProviderProfileSpy).toHaveBeenCalledWith({ name: "hard-profile" })
	})

	it("does not activate an unconfigured/empty mapped profile", async () => {
		await provider.contextProxy.setValue("tierApiConfigs", { hard: "hard-profile-id" })

		vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
			{ name: "hard-profile", id: "hard-profile-id" },
		])
		vi.spyOn(provider.providerSettingsManager, "getProfile").mockResolvedValue({
			name: "hard-profile",
		} as any)
		const activateProviderProfileSpy = vi.spyOn(provider, "activateProviderProfile").mockResolvedValue(undefined)

		await provider.activateTierProfileIfConfigured("hard")

		expect(activateProviderProfileSpy).not.toHaveBeenCalled()
	})

	it("is a no-op when the mapped profile id no longer exists", async () => {
		await provider.contextProxy.setValue("tierApiConfigs", { hard: "stale-id" })

		vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([])
		const activateProviderProfileSpy = vi.spyOn(provider, "activateProviderProfile").mockResolvedValue(undefined)

		await provider.activateTierProfileIfConfigured("hard")

		expect(activateProviderProfileSpy).not.toHaveBeenCalled()
	})
})
