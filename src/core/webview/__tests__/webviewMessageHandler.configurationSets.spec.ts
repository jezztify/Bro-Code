// npx vitest run core/webview/__tests__/webviewMessageHandler.configurationSets.spec.ts

import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"

describe("webviewMessageHandler - configuration sets", () => {
	let mockProvider: {
		context: {
			workspaceState: {
				get: ReturnType<typeof vi.fn>
				update: ReturnType<typeof vi.fn>
			}
		}
		getState: ReturnType<typeof vi.fn>
		postStateToWebview: ReturnType<typeof vi.fn>
		providerSettingsManager: {
			createConfigurationSet: ReturnType<typeof vi.fn>
			renameConfigurationSet: ReturnType<typeof vi.fn>
			deleteConfigurationSet: ReturnType<typeof vi.fn>
			resolveEffectiveConfigurationSetId: ReturnType<typeof vi.fn>
			assignModeConfig: ReturnType<typeof vi.fn>
		}
		applyModeApiConfig: ReturnType<typeof vi.fn>
		activateProviderProfile: ReturnType<typeof vi.fn>
		postMessageToWebview: ReturnType<typeof vi.fn>
		getCurrentTask: ReturnType<typeof vi.fn>
		log: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.clearAllMocks()

		mockProvider = {
			context: {
				workspaceState: {
					get: vi.fn(),
					update: vi.fn().mockResolvedValue(undefined),
				},
			},
			getState: vi.fn().mockResolvedValue({ mode: "code" }),
			postStateToWebview: vi.fn(),
			providerSettingsManager: {
				createConfigurationSet: vi.fn(),
				renameConfigurationSet: vi.fn().mockResolvedValue(undefined),
				deleteConfigurationSet: vi.fn(),
				resolveEffectiveConfigurationSetId: vi.fn(),
				assignModeConfig: vi.fn().mockResolvedValue(undefined),
			},
			applyModeApiConfig: vi.fn(),
			activateProviderProfile: vi.fn().mockResolvedValue(undefined),
			postMessageToWebview: vi.fn(),
			getCurrentTask: vi.fn(),
			log: vi.fn(),
		}
	})

	describe("createConfigurationSet", () => {
		it("creates a set, marks it active for this workspace, and posts state", async () => {
			mockProvider.providerSettingsManager.createConfigurationSet.mockResolvedValue({
				id: "new-set-id",
				name: "Cheap",
				modeApiConfigs: {},
			})

			await webviewMessageHandler(mockProvider as unknown as ClineProvider, {
				type: "createConfigurationSet",
				text: "Cheap",
				values: { seedEmpty: true },
			})

			expect(mockProvider.providerSettingsManager.createConfigurationSet).toHaveBeenCalledWith("Cheap", {
				seedFromId: undefined,
				seedEmpty: true,
			})
			expect(mockProvider.context.workspaceState.update).toHaveBeenCalledWith(
				"activeConfigurationSetId",
				"new-set-id",
			)
			expect(mockProvider.postStateToWebview).toHaveBeenCalled()
		})

		it("does nothing without a name", async () => {
			await webviewMessageHandler(mockProvider as unknown as ClineProvider, {
				type: "createConfigurationSet",
			})

			expect(mockProvider.providerSettingsManager.createConfigurationSet).not.toHaveBeenCalled()
		})
	})

	describe("renameConfigurationSet", () => {
		it("renames the given set and posts state", async () => {
			await webviewMessageHandler(mockProvider as unknown as ClineProvider, {
				type: "renameConfigurationSet",
				values: { id: "set-1", newName: "Best Quality" },
			})

			expect(mockProvider.providerSettingsManager.renameConfigurationSet).toHaveBeenCalledWith(
				"set-1",
				"Best Quality",
			)
			expect(mockProvider.postStateToWebview).toHaveBeenCalled()
		})
	})

	describe("deleteConfigurationSet", () => {
		it("deletes the set and switches the workspace off it if it was active", async () => {
			mockProvider.context.workspaceState.get.mockReturnValue("set-1")
			mockProvider.providerSettingsManager.deleteConfigurationSet.mockResolvedValue({
				newCurrentConfigurationSetId: "set-2",
			})

			await webviewMessageHandler(mockProvider as unknown as ClineProvider, {
				type: "deleteConfigurationSet",
				text: "set-1",
			})

			expect(mockProvider.providerSettingsManager.deleteConfigurationSet).toHaveBeenCalledWith("set-1")
			expect(mockProvider.context.workspaceState.update).toHaveBeenCalledWith("activeConfigurationSetId", "set-2")
			expect(mockProvider.postStateToWebview).toHaveBeenCalled()
		})

		it("leaves a different workspace's active set untouched", async () => {
			mockProvider.context.workspaceState.get.mockReturnValue("set-other")
			mockProvider.providerSettingsManager.deleteConfigurationSet.mockResolvedValue({
				newCurrentConfigurationSetId: "set-2",
			})

			await webviewMessageHandler(mockProvider as unknown as ClineProvider, {
				type: "deleteConfigurationSet",
				text: "set-1",
			})

			expect(mockProvider.context.workspaceState.update).not.toHaveBeenCalledWith(
				"activeConfigurationSetId",
				expect.anything(),
			)
		})
	})

	describe("switchConfigurationSet", () => {
		it("switches the workspace's active set and applies the current mode's mapping within it", async () => {
			mockProvider.context.workspaceState.get.mockReturnValue(false) // lockApiConfigAcrossModes

			await webviewMessageHandler(mockProvider as unknown as ClineProvider, {
				type: "switchConfigurationSet",
				text: "set-2",
			})

			expect(mockProvider.context.workspaceState.update).toHaveBeenCalledWith("activeConfigurationSetId", "set-2")
			expect(mockProvider.applyModeApiConfig).toHaveBeenCalledWith("code", "set-2")
			expect(mockProvider.postStateToWebview).toHaveBeenCalled()
		})

		it("does not reapply the mode's mapping when lockApiConfigAcrossModes is enabled", async () => {
			mockProvider.context.workspaceState.get.mockReturnValue(true) // lockApiConfigAcrossModes

			await webviewMessageHandler(mockProvider as unknown as ClineProvider, {
				type: "switchConfigurationSet",
				text: "set-2",
			})

			expect(mockProvider.applyModeApiConfig).not.toHaveBeenCalled()
			expect(mockProvider.postStateToWebview).toHaveBeenCalled()
		})
	})

	describe("assignModeConfig", () => {
		it("explicitly assigns a profile to a mode within the active set and activates it", async () => {
			mockProvider.providerSettingsManager.resolveEffectiveConfigurationSetId.mockResolvedValue("set-1")

			await webviewMessageHandler(mockProvider as unknown as ClineProvider, {
				type: "assignModeConfig",
				mode: "architect",
				values: { configId: "profile-id" },
			})

			expect(mockProvider.providerSettingsManager.assignModeConfig).toHaveBeenCalledWith(
				"architect",
				"profile-id",
				"set-1",
			)
			expect(mockProvider.activateProviderProfile).toHaveBeenCalledWith({ id: "profile-id" })
		})

		it("does nothing without a mode or configId", async () => {
			await webviewMessageHandler(mockProvider as unknown as ClineProvider, {
				type: "assignModeConfig",
				mode: "architect",
			})

			expect(mockProvider.providerSettingsManager.assignModeConfig).not.toHaveBeenCalled()
		})
	})
})
