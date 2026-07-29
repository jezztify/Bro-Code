// npx vitest run src/components/shell/__tests__/AppShell.spec.tsx

import React from "react"

import { render, screen, fireEvent } from "@/utils/test-utils"

import AppShell from "../AppShell"

vi.mock("../Rail", () => ({
	__esModule: true,
	default: function MockRail({ activeTab, onNavigate }: any) {
		return (
			<div data-testid="rail" data-active-tab={activeTab ?? ""}>
				<button data-testid="rail-navigate-settings" onClick={() => onNavigate("settings")}>
					settings
				</button>
			</div>
		)
	},
}))

vi.mock("../ChatDock", () => ({
	__esModule: true,
	default: React.forwardRef(function MockChatDock(props: any, _ref: any) {
		return (
			<div
				data-testid="chat-dock"
				data-show-announcement={String(props.showAnnouncement)}
				data-expanded={String(props.expanded)}
				data-maximized={String(props.maximized)}>
				<button data-testid="maximize-chat" onClick={() => props.onMaximizedChange(true)}>
					maximize
				</button>
			</div>
		)
	}),
}))

// AppShell no longer owns the maximized flag (App does, so the board can maximize the
// dock on its own), so these render it through the same controlled contract.
const ControlledAppShell = ({ children, ...props }: any) => {
	const [isChatMaximized, setIsChatMaximized] = React.useState(false)
	return (
		<AppShell
			activeTab="board"
			onNavigate={() => {}}
			showAnnouncement={false}
			hideAnnouncement={() => {}}
			isChatMaximized={isChatMaximized}
			onChatMaximizedChange={setIsChatMaximized}
			{...props}>
			{children}
		</AppShell>
	)
}

describe("AppShell", () => {
	it("renders the rail, routed pane content, and the chat dock together", () => {
		render(
			<ControlledAppShell activeTab="board">
				<div data-testid="routed-pane">Board pane</div>
			</ControlledAppShell>,
		)

		expect(screen.getByTestId("rail")).toHaveAttribute("data-active-tab", "board")
		expect(screen.getByTestId("routed-pane")).toBeInTheDocument()
		expect(screen.getByTestId("chat-dock")).toBeInTheDocument()
	})

	it("renders the chat dock even when no pane is routed (the chat tab)", () => {
		render(<ControlledAppShell activeTab={undefined}>{null}</ControlledAppShell>)

		expect(screen.getByTestId("chat-dock")).toBeInTheDocument()
		expect(screen.getByTestId("chat-dock")).toHaveAttribute("data-expanded", "true")
		expect(screen.getByTestId("rail")).toHaveAttribute("data-active-tab", "")
	})

	it("forwards navigation clicks from the rail", () => {
		const onNavigate = vi.fn()
		render(<ControlledAppShell onNavigate={onNavigate}>{null}</ControlledAppShell>)

		fireEvent.click(screen.getByTestId("rail-navigate-settings"))
		expect(onNavigate).toHaveBeenCalledWith("settings")
	})

	it("passes announcement state through to the chat dock", () => {
		render(<ControlledAppShell showAnnouncement={true}>{null}</ControlledAppShell>)

		expect(screen.getByTestId("chat-dock")).toHaveAttribute("data-show-announcement", "true")
	})

	it("hides the routed pane while the chat dock is maximized", () => {
		render(
			<ControlledAppShell>
				<div data-testid="routed-pane">Board pane</div>
			</ControlledAppShell>,
		)

		fireEvent.click(screen.getByTestId("maximize-chat"))
		expect(screen.getByTestId("routed-pane").parentElement).toHaveClass("hidden")
		expect(screen.getByTestId("chat-dock")).toHaveAttribute("data-maximized", "true")
	})

	it("hides the routed pane when the shell is told the dock is maximized", () => {
		render(
			<AppShell
				activeTab="board"
				onNavigate={() => {}}
				showAnnouncement={false}
				hideAnnouncement={() => {}}
				isChatMaximized={true}
				onChatMaximizedChange={() => {}}>
				<div data-testid="routed-pane">Board pane</div>
			</AppShell>,
		)

		expect(screen.getByTestId("routed-pane").parentElement).toHaveClass("hidden")
		expect(screen.getByTestId("chat-dock")).toHaveAttribute("data-maximized", "true")
	})
})
