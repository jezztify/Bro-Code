// npx vitest run src/components/shell/__tests__/Rail.spec.tsx

import React from "react"

import { render, screen, fireEvent } from "@/utils/test-utils"

import Rail from "../Rail"

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

describe("Rail", () => {
	it("renders an icon-only entry for Board, Settings, and Marketplace", () => {
		render(<Rail activeTab={undefined} onNavigate={() => {}} />)

		expect(screen.getByTestId("rail-board-button")).toBeInTheDocument()
		expect(screen.getByTestId("rail-settings-button")).toBeInTheDocument()
		expect(screen.getByTestId("rail-marketplace-button")).toBeInTheDocument()
	})

	it("highlights only the active tab", () => {
		render(<Rail activeTab="settings" onNavigate={() => {}} />)

		expect(screen.getByTestId("rail-settings-button")).toHaveAttribute("aria-current", "true")
		expect(screen.getByTestId("rail-board-button")).not.toHaveAttribute("aria-current")
		expect(screen.getByTestId("rail-marketplace-button")).not.toHaveAttribute("aria-current")
	})

	it("has no active entry when activeTab is undefined (e.g. the chat pane)", () => {
		render(<Rail activeTab={undefined} onNavigate={() => {}} />)

		expect(screen.getByTestId("rail-board-button")).not.toHaveAttribute("aria-current")
		expect(screen.getByTestId("rail-settings-button")).not.toHaveAttribute("aria-current")
		expect(screen.getByTestId("rail-marketplace-button")).not.toHaveAttribute("aria-current")
	})

	it("calls onNavigate with the clicked tab", () => {
		const onNavigate = vi.fn()
		render(<Rail activeTab={undefined} onNavigate={onNavigate} />)

		fireEvent.click(screen.getByTestId("rail-marketplace-button"))
		expect(onNavigate).toHaveBeenCalledWith("marketplace")

		fireEvent.click(screen.getByTestId("rail-board-button"))
		expect(onNavigate).toHaveBeenCalledWith("board")
	})
})
