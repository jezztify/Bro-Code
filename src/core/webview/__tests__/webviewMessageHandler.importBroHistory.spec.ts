import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string) => key),
	changeLanguage: vi.fn(),
}))

import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"

vi.mock("vscode", () => ({
	window: {
		showErrorMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showInformationMessage: vi.fn(),
	},
	workspace: {
		workspaceFolders: undefined,
		getConfiguration: vi.fn(() => ({
			get: vi.fn(),
			update: vi.fn(),
		})),
	},
	env: {
		clipboard: { writeText: vi.fn() },
		openExternal: vi.fn(),
	},
	commands: {
		executeCommand: vi.fn(),
	},
	Uri: {
		parse: vi.fn((s: string) => ({ toString: () => s })),
		file: vi.fn((p: string) => ({ fsPath: p })),
	},
	ConfigurationTarget: {
		Global: 1,
		Workspace: 2,
		WorkspaceFolder: 3,
	},
}))

const importBroTaskHistoryMock = vi.fn()
vi.mock("../../task-persistence/importBroTaskHistory", () => ({
	importBroTaskHistory: (...args: any[]) => importBroTaskHistoryMock(...args),
}))

import * as vscode from "vscode"

describe("webviewMessageHandler - importBroHistory", () => {
	let mockProvider: ClineProvider & {
		contextProxy: any
		taskHistoryStore: {
			invalidateAll: ReturnType<typeof vi.fn>
			reconcile: ReturnType<typeof vi.fn>
			flushIndex: ReturnType<typeof vi.fn>
		}
		postMessageToWebview: ReturnType<typeof vi.fn>
		postStateToWebview: ReturnType<typeof vi.fn>
		log: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.clearAllMocks()

		mockProvider = {
			contextProxy: {
				getValue: vi.fn(),
				setValue: vi.fn(),
				globalStorageUri: { fsPath: "/mock/storage" },
			},
			taskHistoryStore: {
				invalidateAll: vi.fn(),
				reconcile: vi.fn().mockResolvedValue(undefined),
				flushIndex: vi.fn().mockResolvedValue(undefined),
			},
			postMessageToWebview: vi.fn().mockResolvedValue(undefined),
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			log: vi.fn(),
		} as any
	})

	it("refreshes task history, streams progress, and shows a success message after importing Roo history", async () => {
		importBroTaskHistoryMock.mockImplementation(async (_globalStoragePath, onProgress) => {
			await onProgress?.({
				copiedFileCount: 2,
				totalFileCount: 4,
				importedTaskCount: 1,
				totalTaskCount: 2,
				currentTaskId: "task-1",
				currentFileName: "ui_messages.json",
			})

			return {
				rooExtensionDomain: "RooVeterinaryInc.roo-cline",
				broExtensionDomain: "BroCodeOrganization.bro-code",
				rooStorageRoots: ["/mock/roo-storage"],
				broStorageRoot: "/mock/storage",
				foundTaskCount: 2,
				importedTaskCount: 2,
				importedFileCount: 4,
			}
		})

		await webviewMessageHandler(mockProvider as any, { type: "importBroHistory" } as any)

		expect(importBroTaskHistoryMock).toHaveBeenCalledWith("/mock/storage", expect.any(Function))
		expect(mockProvider.taskHistoryStore.invalidateAll).toHaveBeenCalledTimes(1)
		expect(mockProvider.taskHistoryStore.reconcile).toHaveBeenCalledTimes(1)
		expect(mockProvider.taskHistoryStore.flushIndex).toHaveBeenCalledTimes(1)
		expect(mockProvider.postStateToWebview).toHaveBeenCalledTimes(1)
		expect(mockProvider.postMessageToWebview).toHaveBeenNthCalledWith(1, {
			type: "broHistoryImportProgress",
			broHistoryImportProgress: {
				status: "starting",
				copiedFileCount: 0,
				totalFileCount: 0,
				importedTaskCount: 0,
				totalTaskCount: 0,
			},
		})
		expect(mockProvider.postMessageToWebview).toHaveBeenNthCalledWith(2, {
			type: "broHistoryImportProgress",
			broHistoryImportProgress: {
				status: "copying",
				copiedFileCount: 2,
				totalFileCount: 4,
				importedTaskCount: 1,
				totalTaskCount: 2,
				currentTaskId: "task-1",
				currentFileName: "ui_messages.json",
			},
		})
		expect(mockProvider.postMessageToWebview).toHaveBeenNthCalledWith(3, {
			type: "broHistoryImportProgress",
			broHistoryImportProgress: {
				status: "finished",
				copiedFileCount: 4,
				totalFileCount: 4,
				importedTaskCount: 2,
				totalTaskCount: 2,
				currentTaskId: "task-1",
				currentFileName: "ui_messages.json",
			},
		})
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("common:info.broHistoryImport.success")
		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
	})

	it("uses the singular success message when one Roo task history is imported", async () => {
		importBroTaskHistoryMock.mockResolvedValue({
			rooExtensionDomain: "RooVeterinaryInc.roo-cline",
			broExtensionDomain: "BroCodeOrganization.bro-code",
			rooStorageRoots: ["/mock/roo-storage"],
			broStorageRoot: "/mock/storage",
			foundTaskCount: 1,
			importedTaskCount: 1,
			importedFileCount: 2,
		})

		await webviewMessageHandler(mockProvider as any, { type: "importBroHistory" } as any)

		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("common:info.broHistoryImport.success")
		expect(mockProvider.postMessageToWebview).toHaveBeenNthCalledWith(2, {
			type: "broHistoryImportProgress",
			broHistoryImportProgress: {
				status: "finished",
				copiedFileCount: 2,
				totalFileCount: 2,
				importedTaskCount: 1,
				totalTaskCount: 1,
			},
		})
		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
	})

	it("shows a 'not found' warning when no Roo history exists at all", async () => {
		importBroTaskHistoryMock.mockResolvedValue({
			rooExtensionDomain: "RooVeterinaryInc.roo-cline",
			broExtensionDomain: "BroCodeOrganization.bro-code",
			rooStorageRoots: ["/mock/roo-storage"],
			broStorageRoot: "/mock/storage",
			foundTaskCount: 0,
			importedTaskCount: 0,
			importedFileCount: 0,
		})

		await webviewMessageHandler(mockProvider as any, { type: "importBroHistory" } as any)

		expect(importBroTaskHistoryMock).toHaveBeenCalledWith("/mock/storage", expect.any(Function))
		expect(mockProvider.taskHistoryStore.invalidateAll).not.toHaveBeenCalled()
		expect(mockProvider.taskHistoryStore.reconcile).not.toHaveBeenCalled()
		expect(mockProvider.taskHistoryStore.flushIndex).not.toHaveBeenCalled()
		expect(mockProvider.postStateToWebview).not.toHaveBeenCalled()
		expect(mockProvider.postMessageToWebview).toHaveBeenNthCalledWith(2, {
			type: "broHistoryImportProgress",
			broHistoryImportProgress: {
				status: "finished",
				copiedFileCount: 0,
				totalFileCount: 0,
				importedTaskCount: 0,
				totalTaskCount: 0,
			},
		})
		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith("common:warnings.broHistoryImport.nothingFound")
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
	})

	it("shows an 'already imported' warning when all Roo tasks are already in Bro", async () => {
		importBroTaskHistoryMock.mockResolvedValue({
			rooExtensionDomain: "RooVeterinaryInc.roo-cline",
			broExtensionDomain: "BroCodeOrganization.bro-code",
			rooStorageRoots: ["/mock/roo-storage"],
			broStorageRoot: "/mock/storage",
			foundTaskCount: 3,
			importedTaskCount: 0,
			importedFileCount: 0,
		})

		await webviewMessageHandler(mockProvider as any, { type: "importBroHistory" } as any)

		// History is refreshed even when nothing new was imported, so a retry
		// after a partial-copy failure still reconciles the store.
		expect(mockProvider.taskHistoryStore.invalidateAll).toHaveBeenCalledTimes(1)
		expect(mockProvider.taskHistoryStore.reconcile).toHaveBeenCalledTimes(1)
		expect(mockProvider.taskHistoryStore.flushIndex).toHaveBeenCalledTimes(1)
		expect(mockProvider.postStateToWebview).toHaveBeenCalledTimes(1)
		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
			"common:warnings.broHistoryImport.alreadyImported",
		)
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
	})

	it("shows an error without refreshing task history when the import throws", async () => {
		importBroTaskHistoryMock.mockRejectedValue(new Error("permission denied"))

		await webviewMessageHandler(mockProvider as any, { type: "importBroHistory" } as any)

		expect(mockProvider.taskHistoryStore.invalidateAll).not.toHaveBeenCalled()
		expect(mockProvider.taskHistoryStore.reconcile).not.toHaveBeenCalled()
		expect(mockProvider.taskHistoryStore.flushIndex).not.toHaveBeenCalled()
		expect(mockProvider.postStateToWebview).not.toHaveBeenCalled()
		expect(mockProvider.log).toHaveBeenCalledWith("[importBroHistory] failed: permission denied")
		expect(mockProvider.postMessageToWebview).toHaveBeenNthCalledWith(2, {
			type: "broHistoryImportProgress",
			broHistoryImportProgress: {
				status: "failed",
				copiedFileCount: 0,
				totalFileCount: 0,
				importedTaskCount: 0,
				totalTaskCount: 0,
			},
		})
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("common:errors.broHistoryImport")
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
	})
})
