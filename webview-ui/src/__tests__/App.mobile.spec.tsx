// npx vitest run src/__tests__/App.mobile.spec.tsx
//
// Covers the "mobile-mode fixture asserting the tab chrome is hidden and
// ChatView renders full-screen" item from the mobile-server plan's
// verification checklist. The plan originally called for extending the
// Playwright CT visual-snapshot harness (`webview-ui/playwright/` +
// `playwright-ct.config.ts`) for this, but that harness is purely
// screenshot-diff based (`testMatch: "**/*.visual.tsx"`, `toHaveScreenshot`)
// and has no baseline for a new fixture to compare against. A structural
// RTL assertion - same approach as `App.spec.tsx` - covers the same intent
// (tab chrome absent, ChatView full-screen) without needing a checked-in
// baseline image.

import React from "react"
import { render, screen, cleanup } from "@/utils/test-utils"

import AppWithProviders from "../App"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
	ZOO_MOBILE_CONNECTION_EVENT: "zoo-mobile-connection",
}))

vi.mock("@src/components/ErrorBoundary", () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock("@src/utils/TelemetryClient", () => ({
	telemetryClient: {
		capture: vi.fn(),
		updateTelemetryState: vi.fn(),
	},
}))

vi.mock("@src/components/chat/ChatView", () => ({
	__esModule: true,
	default: function ChatView({ isHidden }: { isHidden: boolean }) {
		return (
			<div data-testid="chat-view" data-hidden={isHidden}>
				Chat View
			</div>
		)
	},
}))

vi.mock("@src/components/settings/SettingsView", () => ({
	__esModule: true,
	default: function SettingsView() {
		return <div data-testid="settings-view">Settings View</div>
	},
}))

vi.mock("@src/components/welcome/WelcomeViewProvider", () => ({
	__esModule: true,
	default: function WelcomeView() {
		return <div data-testid="welcome-view">Welcome View</div>
	},
}))

vi.mock("@src/components/history/HistoryView", () => ({
	__esModule: true,
	default: function HistoryView() {
		return <div data-testid="history-view">History View</div>
	},
}))

vi.mock("@src/components/marketplace/MarketplaceView", () => ({
	MarketplaceView: function MarketplaceView() {
		return <div data-testid="marketplace-view">Marketplace View</div>
	},
}))

vi.mock("@src/components/kanban/KanbanBoardView", () => ({
	KanbanBoardView: function KanbanBoardView() {
		return <div data-testid="kanban-view">Kanban View</div>
	},
}))

const mockUseExtensionState = vi.fn()

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
			const MockedComponent = (props: any) => (
				<Component t={tFunction} i18n={{ t: tFunction }} tReady {...props} />
			)
			MockedComponent.displayName = `withTranslation(${Component.displayName || Component.name || "Component"})`
			return MockedComponent
		},
		Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
		useTranslation: () => ({
			t: tFunction,
			i18n: { t: tFunction, changeLanguage: vi.fn(() => Promise.resolve()) },
		}),
		initReactI18next: { type: "3rdParty", init: vi.fn() },
	}
})

vi.mock("@src/i18n/TranslationContext", () => {
	const tFunction = (key: string) => key
	return {
		__esModule: true,
		default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
		useAppTranslation: () => ({
			t: tFunction,
			i18n: { t: tFunction, changeLanguage: vi.fn(() => Promise.resolve()) },
		}),
	}
})

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockUseExtensionState(),
	ExtensionStateContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe("App in mobile mode (window.ZOO_MOBILE_MODE)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		;(window as any).ZOO_MOBILE_MODE = true

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
		delete (window as any).ZOO_MOBILE_MODE
	})

	it("renders ChatView full-screen (not hidden) and skips the desktop tab shell entirely", () => {
		render(<AppWithProviders />)

		const chatView = screen.getByTestId("chat-view")
		expect(chatView).toBeInTheDocument()
		expect(chatView.getAttribute("data-hidden")).toBe("false")
	})

	it("never mounts the Settings/History/Marketplace/Kanban tab chrome, even when messaged to switch tabs", () => {
		render(<AppWithProviders />)

		for (const action of [
			"settingsButtonClicked",
			"historyButtonClicked",
			"marketplaceButtonClicked",
			"kanbanButtonClicked",
		]) {
			window.dispatchEvent(new MessageEvent("message", { data: { type: "action", action } }))
		}

		expect(screen.queryByTestId("settings-view")).not.toBeInTheDocument()
		expect(screen.queryByTestId("history-view")).not.toBeInTheDocument()
		expect(screen.queryByTestId("marketplace-view")).not.toBeInTheDocument()
		expect(screen.queryByTestId("kanban-view")).not.toBeInTheDocument()
		expect(screen.queryByTestId("welcome-view")).not.toBeInTheDocument()

		// ChatView is still the only thing on screen, still full-screen.
		const chatView = screen.getByTestId("chat-view")
		expect(chatView.getAttribute("data-hidden")).toBe("false")
	})

	it("renders the mobile top bar (title + new-task button) instead of tab chrome", () => {
		render(<AppWithProviders />)

		expect(screen.getByText("chat:mobile.title")).toBeInTheDocument()
		expect(screen.getByLabelText("chat:mobile.newTask")).toBeInTheDocument()
	})

	it("still shows MobileApp even when setup/welcome gating would otherwise apply on desktop", () => {
		mockUseExtensionState.mockReturnValue({
			didHydrateState: true,
			showWelcome: true,
			shouldShowAnnouncement: false,
			experiments: {},
			language: "en",
			telemetrySetting: "enabled",
		})

		render(<AppWithProviders />)

		expect(screen.queryByTestId("welcome-view")).not.toBeInTheDocument()
		expect(screen.getByTestId("chat-view")).toBeInTheDocument()
	})
})
