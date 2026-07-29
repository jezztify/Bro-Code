// npx vitest run src/__tests__/App.spec.tsx

import React from "react"
import { render, screen, act, cleanup } from "@/utils/test-utils"

import AppWithProviders from "../App"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock the ErrorBoundary component
vi.mock("@src/components/ErrorBoundary", () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Mock the telemetry client
vi.mock("@src/utils/TelemetryClient", () => ({
	telemetryClient: {
		capture: vi.fn(),
		updateTelemetryState: vi.fn(),
	},
}))

// AppShell (rail + routed pane + persistent chat dock) is unit-tested on its own in
// src/components/shell/__tests__/AppShell.spec.tsx (and Rail/ChatDock have their own specs).
// Here it's mocked down to "which tab is active, and what pane content did App.tsx route into
// it" so these tests stay focused on App.tsx's own routing/gating logic.
vi.mock("@src/components/shell/AppShell", () => ({
	__esModule: true,
	default: React.forwardRef(function MockAppShell(
		{ activeTab, isChatMaximized, onChatMaximizedChange, children }: any,
		_ref: any,
	) {
		return (
			<div
				data-testid="app-shell"
				data-active-tab={activeTab ?? ""}
				data-chat-maximized={String(isChatMaximized)}>
				<button data-testid="restore-chat" onClick={() => onChatMaximizedChange(false)}>
					restore
				</button>
				{children}
			</div>
		)
	}),
}))

vi.mock("@src/components/settings/SettingsView", () => ({
	__esModule: true,
	default: function SettingsView({ onDone }: { onDone: () => void }) {
		return (
			<div data-testid="settings-view" onClick={onDone}>
				Settings View
			</div>
		)
	},
}))

vi.mock("@src/components/welcome/WelcomeViewProvider", () => ({
	__esModule: true,
	default: function WelcomeView() {
		return <div data-testid="welcome-view">Welcome View</div>
	},
}))

vi.mock("@src/components/board/TaskBoardView", () => ({
	__esModule: true,
	default: function TaskBoardView({ onDone }: { onDone: () => void }) {
		return (
			<div data-testid="board-view" onClick={onDone}>
				Board View
			</div>
		)
	},
}))

vi.mock("@src/components/mcp/McpView", () => ({
	__esModule: true,
	default: function McpView() {
		return <div data-testid="mcp-view">MCP View</div>
	},
}))

vi.mock("@src/components/modes/ModesView", () => ({
	__esModule: true,
	default: function ModesView() {
		return <div data-testid="prompts-view">Modes View</div>
	},
}))

vi.mock("@src/components/marketplace/MarketplaceView", () => ({
	MarketplaceView: function MarketplaceView({ onDone }: { onDone: () => void }) {
		return (
			<div data-testid="marketplace-view" onClick={onDone}>
				Marketplace View
			</div>
		)
	},
}))

const mockUseExtensionState = vi.fn()

// Mock i18next and react-i18next
vi.mock("i18next", () => {
	const tFunction = (key: string) => key
	const i18n = {
		t: tFunction,
		use: () => i18n,
		init: () => Promise.resolve(tFunction),
		changeLanguage: vi.fn(() => Promise.resolve()),
	}
	return { default: i18n }
})

vi.mock("react-i18next", () => {
	const tFunction = (key: string) => key
	return {
		withTranslation: () => (Component: any) => {
			const MockedComponent = (props: any) => {
				return <Component t={tFunction} i18n={{ t: tFunction }} tReady {...props} />
			}
			MockedComponent.displayName = `withTranslation(${Component.displayName || Component.name || "Component"})`
			return MockedComponent
		},
		Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
		useTranslation: () => {
			return {
				t: tFunction,
				i18n: {
					t: tFunction,
					changeLanguage: vi.fn(() => Promise.resolve()),
				},
			}
		},
		initReactI18next: {
			type: "3rdParty",
			init: vi.fn(),
		},
	}
})

// Mock TranslationProvider to pass through children
vi.mock("@src/i18n/TranslationContext", () => {
	const tFunction = (key: string) => key
	return {
		__esModule: true,
		default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
		useAppTranslation: () => ({
			t: tFunction,
			i18n: {
				t: tFunction,
				changeLanguage: vi.fn(() => Promise.resolve()),
			},
		}),
	}
})

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockUseExtensionState(),
	ExtensionStateContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Mock environment variables
vi.mock("process.env", () => ({
	NODE_ENV: "test",
	PKG_VERSION: "1.0.0-test",
}))

describe("App", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		window.removeEventListener("message", () => {})

		// Set up default mock return value
		mockUseExtensionState.mockReturnValue({
			didHydrateState: true,
			showWelcome: false,
			shouldShowAnnouncement: false,
			experiments: {},
			language: "en",
			telemetrySetting: "enabled",
		})
	})

	afterEach(() => {
		cleanup()
		window.removeEventListener("message", () => {})
	})

	const triggerMessage = (action: string) => {
		const messageEvent = new MessageEvent("message", {
			data: {
				type: "action",
				action,
			},
		})
		window.dispatchEvent(messageEvent)
	}

	const createSetupIncompleteState = () => ({
		didHydrateState: true,
		showWelcome: true,
		shouldShowAnnouncement: false,
		experiments: {},
		language: "en",
		telemetrySetting: "enabled",
	})

	it("shows the shell routed to the board pane by default", () => {
		render(<AppWithProviders />)

		expect(screen.getByTestId("app-shell")).toHaveAttribute("data-active-tab", "board")
		expect(screen.getByTestId("board-view")).toBeInTheDocument()
	}, 10000)

	it("shows welcome view when setup is incomplete", () => {
		mockUseExtensionState.mockReturnValue({
			didHydrateState: true,
			showWelcome: true,
			shouldShowAnnouncement: false,
			experiments: {},
			language: "en",
			telemetrySetting: "enabled",
		})

		render(<AppWithProviders />)

		expect(screen.getByTestId("welcome-view")).toBeInTheDocument()
		expect(screen.queryByTestId("settings-view")).not.toBeInTheDocument()
	})

	it("switches to settings view when receiving settingsButtonClicked action", async () => {
		render(<AppWithProviders />)

		act(() => {
			triggerMessage("settingsButtonClicked")
		})

		const settingsView = await screen.findByTestId("settings-view")
		expect(settingsView).toBeInTheDocument()
		expect(screen.getByTestId("app-shell")).toHaveAttribute("data-active-tab", "settings")
		expect(screen.queryByTestId("board-view")).not.toBeInTheDocument()
	})

	it.each([
		["settings", "settings-view"],
		["marketplace", "marketplace-view"],
	])("still switches to %s while welcome gating is active", async (action, testId) => {
		mockUseExtensionState.mockReturnValue({
			didHydrateState: true,
			showWelcome: true,
			shouldShowAnnouncement: false,
			experiments: {},
			language: "en",
			telemetrySetting: "enabled",
		})

		render(<AppWithProviders />)

		act(() => {
			triggerMessage(`${action}ButtonClicked`)
		})

		expect(await screen.findByTestId(testId)).toBeInTheDocument()
		expect(screen.queryByTestId("welcome-view")).not.toBeInTheDocument()
	})

	it("keeps board behind the welcome gate while setup is incomplete", () => {
		mockUseExtensionState.mockReturnValue({
			didHydrateState: true,
			showWelcome: true,
			shouldShowAnnouncement: false,
			experiments: {},
			language: "en",
			telemetrySetting: "enabled",
		})

		render(<AppWithProviders />)

		act(() => {
			triggerMessage("boardButtonClicked")
		})

		expect(screen.getByTestId("welcome-view")).toBeInTheDocument()
		expect(screen.queryByTestId("board-view")).not.toBeInTheDocument()
	})

	it.each([
		{ label: "chat", action: undefined },
		{ label: "board", action: "boardButtonClicked" },
	])("redirects to providers settings when an import fires from the $label tab", async ({ action }) => {
		const state = {
			...createSetupIncompleteState(),
			settingsImportedAt: undefined as number | undefined,
		}

		mockUseExtensionState.mockImplementation(() => state)

		const { rerender } = render(<AppWithProviders />)

		if (action) {
			act(() => {
				triggerMessage(action)
			})
		}

		if (action === "boardButtonClicked") {
			expect(screen.getByTestId("welcome-view")).toBeInTheDocument()
		}

		state.settingsImportedAt = Date.now()
		rerender(<AppWithProviders />)

		expect(await screen.findByTestId("settings-view")).toBeInTheDocument()
		expect(screen.queryByTestId("welcome-view")).not.toBeInTheDocument()
	})

	it.each([
		{
			label: "settings before returning to chat",
			action: "settingsButtonClicked",
			viewId: "settings-view",
			nextAction: undefined,
		},
		{
			label: "settings before switching to board",
			action: "settingsButtonClicked",
			viewId: "settings-view",
			nextAction: "boardButtonClicked",
		},
		{
			label: "marketplace before returning to chat",
			action: "marketplaceButtonClicked",
			viewId: "marketplace-view",
			nextAction: undefined,
		},
		{
			label: "marketplace before switching to board",
			action: "marketplaceButtonClicked",
			viewId: "marketplace-view",
			nextAction: "boardButtonClicked",
		},
	])(
		"consumes imported settings without a later redirect when already on $label",
		async ({ action, viewId, nextAction }) => {
			const state = {
				...createSetupIncompleteState(),
				settingsImportedAt: undefined as number | undefined,
			}

			mockUseExtensionState.mockImplementation(() => state)

			const { rerender } = render(<AppWithProviders />)

			act(() => {
				triggerMessage(action)
			})

			expect(await screen.findByTestId(viewId)).toBeInTheDocument()
			expect(screen.queryByTestId("welcome-view")).not.toBeInTheDocument()

			state.settingsImportedAt = Date.now()
			rerender(<AppWithProviders />)

			const currentView = await screen.findByTestId(viewId)
			expect(currentView).toBeInTheDocument()

			if (nextAction) {
				act(() => {
					triggerMessage(nextAction)
				})
			} else {
				act(() => {
					currentView.click()
				})
			}

			expect(screen.getByTestId("welcome-view")).toBeInTheDocument()
			expect(screen.queryByTestId("settings-view")).not.toBeInTheDocument()
			expect(screen.queryByTestId("marketplace-view")).not.toBeInTheDocument()
		},
	)

	it("does not bounce back to settings after the import redirect has already fired", async () => {
		const importedAt = Date.now()

		mockUseExtensionState.mockReturnValue({
			...createSetupIncompleteState(),
			settingsImportedAt: importedAt,
		})

		render(<AppWithProviders />)

		const settingsView = await screen.findByTestId("settings-view")
		expect(settingsView).toBeInTheDocument()

		act(() => {
			settingsView.click()
		})

		expect(screen.getByTestId("welcome-view")).toBeInTheDocument()
		expect(screen.queryByTestId("settings-view")).not.toBeInTheDocument()
	})

	it("switches to board view when receiving boardButtonClicked action", async () => {
		render(<AppWithProviders />)

		act(() => {
			triggerMessage("settingsButtonClicked")
		})
		await screen.findByTestId("settings-view")

		act(() => {
			triggerMessage("boardButtonClicked")
		})

		const boardView = await screen.findByTestId("board-view")
		expect(boardView).toBeInTheDocument()
		expect(screen.getByTestId("app-shell")).toHaveAttribute("data-active-tab", "board")
	})

	it("routes to no pane (chat) when clicking done in settings view, while the shell (and its persistent dock) stays mounted", async () => {
		render(<AppWithProviders />)

		act(() => {
			triggerMessage("settingsButtonClicked")
		})

		const settingsView = await screen.findByTestId("settings-view")

		act(() => {
			settingsView.click()
		})

		expect(screen.getByTestId("app-shell")).toHaveAttribute("data-active-tab", "")
		expect(screen.queryByTestId("settings-view")).not.toBeInTheDocument()
		expect(screen.queryByTestId("board-view")).not.toBeInTheDocument()
	})

	it("switches to marketplace view when receiving marketplaceButtonClicked action", async () => {
		render(<AppWithProviders />)

		act(() => {
			triggerMessage("marketplaceButtonClicked")
		})

		const marketplaceView = await screen.findByTestId("marketplace-view")
		expect(marketplaceView).toBeInTheDocument()
		expect(screen.getByTestId("app-shell")).toHaveAttribute("data-active-tab", "marketplace")
	})

	it("returns to no pane (chat) when clicking done in marketplace view", async () => {
		render(<AppWithProviders />)

		act(() => {
			triggerMessage("marketplaceButtonClicked")
		})

		const marketplaceView = await screen.findByTestId("marketplace-view")

		act(() => {
			marketplaceView.click()
		})

		expect(screen.getByTestId("app-shell")).toHaveAttribute("data-active-tab", "")
		expect(screen.queryByTestId("marketplace-view")).not.toBeInTheDocument()
	})

	it("maximizes the dock over the board instead of leaving it when chatButtonClicked is received", async () => {
		render(<AppWithProviders />)

		expect(screen.getByTestId("board-view")).toBeInTheDocument()

		act(() => {
			triggerMessage("chatButtonClicked")
		})

		// The board tab stays selected, so restoring the dock brings the board straight back.
		expect(screen.getByTestId("app-shell")).toHaveAttribute("data-active-tab", "board")
		expect(screen.getByTestId("app-shell")).toHaveAttribute("data-chat-maximized", "true")

		act(() => {
			screen.getByTestId("restore-chat").click()
		})

		expect(screen.getByTestId("app-shell")).toHaveAttribute("data-chat-maximized", "false")
		expect(screen.getByTestId("board-view")).toBeInTheDocument()
	})

	it("clears the routed pane when chatButtonClicked arrives from a pane other than the board", async () => {
		render(<AppWithProviders />)

		act(() => {
			triggerMessage("settingsButtonClicked")
		})
		await screen.findByTestId("settings-view")

		act(() => {
			triggerMessage("chatButtonClicked")
		})

		expect(screen.getByTestId("app-shell")).toHaveAttribute("data-active-tab", "")
		expect(screen.queryByTestId("settings-view")).not.toBeInTheDocument()
	})

	it("stops the maximized dock from covering a pane the user navigates to", async () => {
		render(<AppWithProviders />)

		act(() => {
			triggerMessage("chatButtonClicked")
		})
		expect(screen.getByTestId("app-shell")).toHaveAttribute("data-chat-maximized", "true")

		act(() => {
			triggerMessage("settingsButtonClicked")
		})

		expect(await screen.findByTestId("settings-view")).toBeInTheDocument()
		expect(screen.getByTestId("app-shell")).toHaveAttribute("data-chat-maximized", "false")
	})
})
