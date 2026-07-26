// npx vitest run src/components/settings/__tests__/ConfigurationSetManager.spec.tsx

import { render, screen, fireEvent, waitFor } from "@/utils/test-utils"

import ConfigurationSetManager from "../ConfigurationSetManager"

vitest.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({ value, onInput, placeholder, onKeyDown, "data-testid": dataTestId }: any) => (
		<input
			value={value}
			onChange={(e) => onInput(e)}
			placeholder={placeholder}
			onKeyDown={onKeyDown}
			data-testid={dataTestId}
		/>
	),
	VSCodeCheckbox: ({ children, checked, onChange, "data-testid": dataTestId }: any) => (
		<label>
			<input
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange({ target: { checked: e.target.checked } })}
				data-testid={dataTestId}
			/>
			{children}
		</label>
	),
}))

const twoSets = [
	{ id: "set-1", name: "Default" },
	{ id: "set-2", name: "Cheap" },
]

describe("ConfigurationSetManager", () => {
	it("renders the active set and lists all configuration sets in the selector", () => {
		render(
			<ConfigurationSetManager
				activeConfigurationSetId="set-1"
				configurationSets={twoSets}
				onSelectSet={vi.fn()}
				onCreateSet={vi.fn()}
				onRenameSet={vi.fn()}
				onDeleteSet={vi.fn()}
			/>,
		)

		expect(screen.getByTestId("configuration-set-select")).toBeInTheDocument()
		expect(screen.getByTestId("delete-configuration-set-button")).not.toBeDisabled()
	})

	it("disables delete when there is only one configuration set", () => {
		render(
			<ConfigurationSetManager
				activeConfigurationSetId="set-1"
				configurationSets={[{ id: "set-1", name: "Default" }]}
				onSelectSet={vi.fn()}
				onCreateSet={vi.fn()}
				onRenameSet={vi.fn()}
				onDeleteSet={vi.fn()}
			/>,
		)

		expect(screen.getByTestId("delete-configuration-set-button")).toBeDisabled()
	})

	it("calls onDeleteSet with the active set id", () => {
		const onDeleteSet = vi.fn()

		render(
			<ConfigurationSetManager
				activeConfigurationSetId="set-1"
				configurationSets={twoSets}
				onSelectSet={vi.fn()}
				onCreateSet={vi.fn()}
				onRenameSet={vi.fn()}
				onDeleteSet={onDeleteSet}
			/>,
		)

		fireEvent.click(screen.getByTestId("delete-configuration-set-button"))
		expect(onDeleteSet).toHaveBeenCalledWith("set-1")
	})

	it("opens the create dialog, validates duplicate names, and creates a new set", async () => {
		const onCreateSet = vi.fn()

		render(
			<ConfigurationSetManager
				activeConfigurationSetId="set-1"
				configurationSets={twoSets}
				onSelectSet={vi.fn()}
				onCreateSet={onCreateSet}
				onRenameSet={vi.fn()}
				onDeleteSet={vi.fn()}
			/>,
		)

		fireEvent.click(screen.getByTestId("add-configuration-set-button"))

		const input = await screen.findByTestId("new-configuration-set-input")
		fireEvent.input(input, { target: { value: "Cheap" } })
		fireEvent.click(screen.getByTestId("create-configuration-set-button"))

		// Duplicate name (case-insensitive) is rejected without calling onCreateSet.
		expect(onCreateSet).not.toHaveBeenCalled()
		expect(screen.getByTestId("error-message")).toBeInTheDocument()

		fireEvent.input(input, { target: { value: "Best Quality" } })
		fireEvent.click(screen.getByTestId("create-configuration-set-button"))

		await waitFor(() => expect(onCreateSet).toHaveBeenCalledWith("Best Quality", true))
	})

	it("renames the active set via the inline rename form", async () => {
		const onRenameSet = vi.fn()

		render(
			<ConfigurationSetManager
				activeConfigurationSetId="set-1"
				configurationSets={twoSets}
				onSelectSet={vi.fn()}
				onCreateSet={vi.fn()}
				onRenameSet={onRenameSet}
				onDeleteSet={vi.fn()}
			/>,
		)

		fireEvent.click(screen.getByTestId("rename-configuration-set-button"))

		const input = await screen.findByTestId("save-rename-set-button")
		expect(input).toBeInTheDocument()

		const renameInputs = document.querySelectorAll("[data-testid='rename-set-form'] input")
		fireEvent.change(renameInputs[0], { target: { value: "Renamed Default" } })
		fireEvent.click(screen.getByTestId("save-rename-set-button"))

		expect(onRenameSet).toHaveBeenCalledWith("set-1", "Renamed Default")
	})
})
