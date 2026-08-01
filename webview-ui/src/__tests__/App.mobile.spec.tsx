// npx vitest run src/__tests__/App.mobile.spec.tsx
//
// Mobile mode used to render a chat-only shell, so this file used to assert the
// tab chrome was *absent*. It now asserts the opposite: a phone gets the same
// AppShell as desktop (rail + routed board pane + chat dock), because the whole
// point of serving the webview-ui bundle over the LAN is reaching the board from
// a phone, not just the chat. A structural RTL assertion - same approach as
// `App.spec.tsx` - covers this without needing the Playwright CT harness's
// checked-in screenshot baselines.

import React from "react"
import { render, screen, cleanup, act } from "@/utils/test-utils"

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

// forwardRef in both mocks: AppShell/ChatDock and App hand these components a
// ref, which a plain function component cannot accept.
vi.mock("@src/components/chat/ChatView", () => ({
	__esModule: true,
	default: React.forwardRef(function ChatView({ isHidden }: { isHidden: boolean }, _ref: React.Ref<unknown>) {
		return (
			<div data-testid="chat-view" data-hidden={isHidden}>
				Chat View
			</div>
		)
	}),
}))

vi.mock("@src/components/settings/SettingsView", () => ({
	__esModule: true,
	default: React.forwardRef(function SettingsView(_props: unknown, _ref: React.Ref<unknown>) {
		return <div data-testid="settings-view">Settings View</div>
	}),
}))

vi.mock("@src/components/welcome/WelcomeViewProvider", () => ({
	__esModule: true,
	default: function WelcomeView() {
		return <div data-testid="welcome-view">Welcome View</div>
	},
}))

vi.mock("@src/components/board/TaskBoardView", () => ({
	__esModule: true,
	default: function TaskBoardView() {
		return <div data-testid="board-view">Board View</div>
	},
}))

vi.mock("@src/components/marketplace/MarketplaceView", () => ({
	MarketplaceView: function MarketplaceView() {
		return <div data-testid="marketplace-view">Marketplace View</div>
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

const baseExtensionState = {
	didHydrateState: true,
	showWelcome: false,
	shouldShowAnnouncement: false,
	experiments: {},
	language: "en",
	telemetrySetting: "enabled",
	// Read by ChatDock, which mobile now mounts along with the rest of the shell.
	taskHistory: [],
	currentTaskItem: undefined,
	cwd: "/workspace",
}

describe("App in mobile mode (window.ZOO_MOBILE_MODE)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		;(window as any).ZOO_MOBILE_MODE = true

		mockUseExtensionState.mockReturnValue(baseExtensionState)
	})

	afterEach(() => {
		cleanup()
		delete (window as any).ZOO_MOBILE_MODE
	})

	it("renders the full shell - rail, board pane and chat dock - not a chat-only screen", () => {
		render(<AppWithProviders />)

		expect(screen.getByTestId("app-shell")).toBeInTheDocument()
		expect(screen.getByTestId("app-shell-rail")).toBeInTheDocument()
		expect(screen.getByTestId("board-view")).toBeInTheDocument()

		const chatView = screen.getByTestId("chat-view")
		expect(screen.getByTestId("chat-dock")).toContainElement(chatView)
		expect(chatView.getAttribute("data-hidden")).toBe("false")
	})

	it("switches the routed pane on mobile the same way desktop does", () => {
		render(<AppWithProviders />)

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", { data: { type: "action", action: "settingsButtonClicked" } }),
			)
		})
		expect(screen.getByTestId("settings-view")).toBeInTheDocument()
		expect(screen.queryByTestId("board-view")).not.toBeInTheDocument()

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", { data: { type: "action", action: "marketplaceButtonClicked" } }),
			)
		})
		expect(screen.getByTestId("marketplace-view")).toBeInTheDocument()

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", { data: { type: "action", action: "boardButtonClicked" } }),
			)
		})
		expect(screen.getByTestId("board-view")).toBeInTheDocument()

		// The dock stays mounted across every one of those switches.
		expect(screen.getByTestId("chat-view")).toBeInTheDocument()
	})

	it("skips the welcome/setup gate that would otherwise apply on desktop", () => {
		mockUseExtensionState.mockReturnValue({ ...baseExtensionState, showWelcome: true })

		render(<AppWithProviders />)

		expect(screen.queryByTestId("welcome-view")).not.toBeInTheDocument()
		expect(screen.getByTestId("board-view")).toBeInTheDocument()
		expect(screen.getByTestId("chat-view")).toBeInTheDocument()
	})

	it("shows the reconnecting banner only while the mobile transport is down", () => {
		render(<AppWithProviders />)

		expect(screen.queryByTestId("mobile-connection-banner")).not.toBeInTheDocument()

		act(() => {
			window.dispatchEvent(new CustomEvent("zoo-mobile-connection", { detail: { status: "reconnecting" } }))
		})
		expect(screen.getByTestId("mobile-connection-banner")).toBeInTheDocument()

		act(() => {
			window.dispatchEvent(new CustomEvent("zoo-mobile-connection", { detail: { status: "open" } }))
		})
		expect(screen.queryByTestId("mobile-connection-banner")).not.toBeInTheDocument()
	})
})
