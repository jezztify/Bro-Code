// npx vitest run src/components/shell/__tests__/ChatDock.spec.tsx

import React from "react"

import { render, screen, fireEvent } from "@/utils/test-utils"

import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"

import ChatDock from "../ChatDock"

vi.mock("@src/context/ExtensionStateContext")
vi.mock("@src/utils/vscode")

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@src/components/chat/ChatView", () => ({
	__esModule: true,
	default: React.forwardRef(function MockChatView(props: any, _ref: any) {
		return (
			<div
				data-testid="chat-view"
				data-variant={props.variant}
				data-is-hidden={String(props.isHidden)}
				data-show-announcement={String(props.showAnnouncement)}
			/>
		)
	}),
}))

const task = (overrides: Record<string, any>) => ({
	number: 1,
	tokensIn: 0,
	tokensOut: 0,
	totalCost: 0,
	workspace: "/ws",
	task: "A task",
	...overrides,
})

const openTaskList = () => fireEvent.click(screen.getByTestId("chat-dock-task-list-trigger"))

describe("ChatDock", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders no task-list trigger when taskHistory is empty", () => {
		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			taskHistory: [],
			currentTaskItem: undefined,
		})

		render(<ChatDock showAnnouncement={false} hideAnnouncement={() => {}} />)

		expect(screen.queryByTestId("chat-dock-task-list-trigger")).not.toBeInTheDocument()
	})

	it("starts a new empty chat from the dock toolbar", () => {
		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			taskHistory: [],
			currentTaskItem: undefined,
		})

		render(<ChatDock showAnnouncement={false} hideAnnouncement={() => {}} />)
		fireEvent.click(screen.getByRole("button", { name: "shell:dock.newChat" }))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "unfocusTask" })
	})

	it("shows workspace task chats in a dropdown list", () => {
		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			taskHistory: [task({ id: "task-1", ts: 1 })],
			currentTaskItem: undefined,
			cwd: "/ws",
		})

		render(<ChatDock showAnnouncement={false} hideAnnouncement={() => {}} />)

		openTaskList()

		expect(screen.getByTestId("chat-dock-task-list")).toBeInTheDocument()
		expect(screen.getByTestId("task-chip-task-1")).toBeInTheDocument()
	})

	it("closes the task-chat dropdown when Escape is pressed", () => {
		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			taskHistory: [task({ id: "task-1", ts: 1 })],
			currentTaskItem: undefined,
			cwd: "/ws",
		})

		render(<ChatDock showAnnouncement={false} hideAnnouncement={() => {}} />)
		openTaskList()
		fireEvent.keyDown(document, { key: "Escape" })

		expect(screen.queryByTestId("chat-dock-task-list")).not.toBeInTheDocument()
	})

	it("renders chips for recent tasks, newest first, capped at 6", () => {
		const history = Array.from({ length: 8 }, (_, i) => task({ id: `t${i}`, ts: i, task: `Task ${i}` }))

		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			taskHistory: history,
			currentTaskItem: undefined,
			cwd: "/ws",
		})

		render(<ChatDock showAnnouncement={false} hideAnnouncement={() => {}} />)
		openTaskList()

		const taskList = screen.getByTestId("chat-dock-task-list")
		expect(taskList).toBeInTheDocument()

		// Newest (highest ts) first: t7..t2, capped at 6.
		expect(screen.getByTestId("task-chip-t7")).toBeInTheDocument()
		expect(screen.getByTestId("task-chip-t2")).toBeInTheDocument()
		expect(screen.queryByTestId("task-chip-t1")).not.toBeInTheDocument()
		expect(screen.queryByTestId("task-chip-t0")).not.toBeInTheDocument()
	})

	it("only renders task chats for the opened workspace", () => {
		const history = [
			task({ id: "opened", ts: 2, workspace: "/workspace/opened" }),
			task({ id: "other", ts: 1, workspace: "/workspace/other" }),
		]

		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			taskHistory: history,
			currentTaskItem: undefined,
			cwd: "/workspace/opened",
		})

		render(<ChatDock showAnnouncement={false} hideAnnouncement={() => {}} />)
		openTaskList()

		expect(screen.getByTestId("task-chip-opened")).toBeInTheDocument()
		expect(screen.queryByTestId("task-chip-other")).not.toBeInTheDocument()
	})

	it("marks the current task's chip active and does not send showTaskWithId when clicked", () => {
		const history = [task({ id: "a", ts: 2, task: "A" }), task({ id: "b", ts: 1, task: "B" })]

		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			taskHistory: history,
			currentTaskItem: { id: "a" },
			cwd: "/ws",
		})

		render(<ChatDock showAnnouncement={false} hideAnnouncement={() => {}} />)
		openTaskList()

		const activeChip = screen.getByTestId("task-chip-a")
		expect(activeChip).toHaveAttribute("aria-current", "true")

		fireEvent.click(activeChip)
		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	it("sends showTaskWithId when a non-active chip is clicked", () => {
		const history = [task({ id: "a", ts: 2, task: "A" }), task({ id: "b", ts: 1, task: "B" })]

		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			taskHistory: history,
			currentTaskItem: { id: "a" },
			cwd: "/ws",
		})

		render(<ChatDock showAnnouncement={false} hideAnnouncement={() => {}} />)
		openTaskList()

		fireEvent.click(screen.getByTestId("task-chip-b"))
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "showTaskWithId", text: "b" })
	})

	it("closes a background task chat without deleting its history or selecting it", () => {
		const history = [task({ id: "a", ts: 2, task: "A" }), task({ id: "b", ts: 1, task: "B" })]

		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			taskHistory: history,
			currentTaskItem: { id: "a" },
			cwd: "/ws",
		})

		render(<ChatDock showAnnouncement={false} hideAnnouncement={() => {}} />)
		openTaskList()

		fireEvent.click(screen.getByTestId("task-chip-close-b"))

		expect(screen.queryByTestId("task-chip-b")).not.toBeInTheDocument()
		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	it("closes the active task chat without interrupting its task", () => {
		const history = [task({ id: "a", ts: 2, task: "A" }), task({ id: "b", ts: 1, task: "B" })]

		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			taskHistory: history,
			currentTaskItem: { id: "a" },
			cwd: "/ws",
		})

		render(<ChatDock showAnnouncement={false} hideAnnouncement={() => {}} />)
		openTaskList()

		fireEvent.click(screen.getByTestId("task-chip-close-a"))

		expect(screen.queryByTestId("task-chip-a")).not.toBeInTheDocument()
		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	it("renders the inner ChatView in docked, always-visible mode", () => {
		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			taskHistory: [],
			currentTaskItem: undefined,
		})

		render(<ChatDock showAnnouncement={true} hideAnnouncement={() => {}} />)

		const chatView = screen.getByTestId("chat-view")
		expect(chatView).toHaveAttribute("data-variant", "docked")
		expect(chatView).toHaveAttribute("data-is-hidden", "false")
		expect(chatView).toHaveAttribute("data-show-announcement", "true")
	})

	it("collapses the dock and reopens it without unmounting the chat", () => {
		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			taskHistory: [],
			currentTaskItem: undefined,
		})

		render(<ChatDock showAnnouncement={false} hideAnnouncement={() => {}} />)

		const toggle = screen.getByRole("button", { name: "shell:dock.collapseChat" })
		expect(toggle).toHaveAttribute("aria-expanded", "true")
		fireEvent.click(toggle)

		expect(screen.getByTestId("chat-dock")).toHaveClass("h-11")
		expect(screen.getByTestId("chat-view")).toHaveAttribute("data-is-hidden", "true")
		expect(screen.getByRole("button", { name: "shell:dock.expandChat" })).toHaveAttribute("aria-expanded", "false")

		fireEvent.click(screen.getByRole("button", { name: "shell:dock.expandChat" }))
		expect(screen.getByTestId("chat-view")).toHaveAttribute("data-is-hidden", "false")
	})

	it("asks the shell to maximize and restore, without deciding on its own", () => {
		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			taskHistory: [],
			currentTaskItem: undefined,
		})
		const onMaximizedChange = vi.fn()

		const { rerender } = render(
			<ChatDock showAnnouncement={false} hideAnnouncement={() => {}} onMaximizedChange={onMaximizedChange} />,
		)

		fireEvent.click(screen.getByRole("button", { name: "shell:dock.maximizeChat" }))
		expect(onMaximizedChange).toHaveBeenCalledWith(true)
		// The dock stays at its standard height until the shell hands the flag back.
		expect(screen.getByTestId("chat-dock")).toHaveClass("h-[45vh]")

		rerender(
			<ChatDock
				showAnnouncement={false}
				hideAnnouncement={() => {}}
				maximized={true}
				onMaximizedChange={onMaximizedChange}
			/>,
		)
		expect(screen.getByTestId("chat-dock")).toHaveClass("flex-1")

		fireEvent.click(screen.getByRole("button", { name: "shell:dock.restoreChat" }))
		expect(onMaximizedChange).toHaveBeenCalledWith(false)
	})

	it("reserves a large non-shrinking message viewport while a routed pane is open", () => {
		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			taskHistory: [],
			currentTaskItem: undefined,
		})

		render(<ChatDock showAnnouncement={false} hideAnnouncement={() => {}} />)

		const dock = screen.getByTestId("chat-dock")
		expect(dock).toHaveClass("h-[45vh]")
		// The large floor is desktop-width-only: on a phone (the mobile server serves
		// this same shell over the LAN) it would squeeze the routed pane off screen.
		expect(dock).toHaveClass("sm:min-h-[400px]")
		expect(dock).toHaveClass("min-h-[240px]")
		expect(dock).toHaveClass("max-h-[560px]")
		expect(dock).toHaveClass("shrink-0")
	})

	describe("resizing the top edge", () => {
		// jsdom lays nothing out, so the dock reports the height a real layout would.
		const renderDockWithHeight = (height: number) => {
			;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
				taskHistory: [],
				currentTaskItem: undefined,
			})
			const view = render(<ChatDock showAnnouncement={false} hideAnnouncement={() => {}} />)
			vi.spyOn(screen.getByTestId("chat-dock"), "getBoundingClientRect").mockReturnValue({
				height,
			} as DOMRect)
			return view
		}

		const drag = (fromY: number, toY: number) => {
			fireEvent.mouseDown(screen.getByTestId("chat-dock-resize-handle"), { clientY: fromY })
			fireEvent.mouseMove(document, { clientY: toY })
			fireEvent.mouseUp(document)
		}

		it("grows the dock when its top edge is dragged up", () => {
			renderDockWithHeight(400)

			drag(500, 380)

			expect(screen.getByTestId("chat-dock")).toHaveStyle({ height: "520px" })
		})

		it("shrinks the dock when its top edge is dragged down", () => {
			renderDockWithHeight(400)

			drag(500, 610)

			expect(screen.getByTestId("chat-dock")).toHaveStyle({ height: "290px" })
		})

		it("keeps the dock usable and leaves room for the pane above it", () => {
			renderDockWithHeight(400)

			drag(500, 5000)
			expect(screen.getByTestId("chat-dock")).toHaveStyle({ height: "160px" })

			drag(500, -5000)
			expect(screen.getByTestId("chat-dock")).toHaveStyle({
				height: `${window.innerHeight - 120}px`,
			})
		})

		it("stops dragging once the mouse is released", () => {
			renderDockWithHeight(400)

			drag(500, 460)
			expect(screen.getByTestId("chat-dock")).toHaveStyle({ height: "440px" })

			fireEvent.mouseMove(document, { clientY: 100 })
			expect(screen.getByTestId("chat-dock")).toHaveStyle({ height: "440px" })
		})

		it("resizes from the keyboard for users who cannot drag", () => {
			renderDockWithHeight(400)
			const handle = screen.getByTestId("chat-dock-resize-handle")

			fireEvent.keyDown(handle, { key: "ArrowUp" })
			expect(screen.getByTestId("chat-dock")).toHaveStyle({ height: "424px" })

			fireEvent.keyDown(handle, { key: "ArrowDown" })
			expect(screen.getByTestId("chat-dock")).toHaveStyle({ height: "400px" })
		})

		it("offers no resize handle when the dock fills the column or is collapsed", () => {
			;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
				taskHistory: [],
				currentTaskItem: undefined,
			})

			const { rerender } = render(<ChatDock expanded showAnnouncement={false} hideAnnouncement={() => {}} />)
			expect(screen.queryByTestId("chat-dock-resize-handle")).not.toBeInTheDocument()

			rerender(<ChatDock maximized showAnnouncement={false} hideAnnouncement={() => {}} />)
			expect(screen.queryByTestId("chat-dock-resize-handle")).not.toBeInTheDocument()

			rerender(<ChatDock showAnnouncement={false} hideAnnouncement={() => {}} />)
			fireEvent.click(screen.getByRole("button", { name: "shell:dock.collapseChat" }))
			expect(screen.queryByTestId("chat-dock-resize-handle")).not.toBeInTheDocument()
		})
	})

	it("expands to fill the content area for the chat tab", () => {
		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			taskHistory: [],
			currentTaskItem: undefined,
		})

		render(<ChatDock expanded showAnnouncement={false} hideAnnouncement={() => {}} />)

		expect(screen.getByTestId("chat-dock")).toHaveClass("flex-1")
		expect(screen.queryByRole("button", { name: "shell:dock.collapseChat" })).not.toBeInTheDocument()
	})
})
