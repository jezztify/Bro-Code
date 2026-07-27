// npx vitest run src/components/settings/__tests__/TierApiConfiguration.spec.tsx

import { render, screen, fireEvent } from "@/utils/test-utils"

import { vscode } from "@src/utils/vscode"

import TierApiConfiguration from "../TierApiConfiguration"

vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

const listApiConfigMeta = [
	{ id: "cheap-id", name: "Cheap Model" },
	{ id: "best-id", name: "Best Model" },
]

describe("TierApiConfiguration", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders one row per difficulty tier", () => {
		render(<TierApiConfiguration tierApiConfigs={{}} listApiConfigMeta={listApiConfigMeta} />)

		expect(screen.getByTestId("tier-label-trivial")).toBeInTheDocument()
		expect(screen.getByTestId("tier-label-standard")).toBeInTheDocument()
		expect(screen.getByTestId("tier-label-hard")).toBeInTheDocument()
		expect(screen.getByTestId("tier-api-config-select-trivial")).toBeInTheDocument()
		expect(screen.getByTestId("tier-api-config-select-standard")).toBeInTheDocument()
		expect(screen.getByTestId("tier-api-config-select-hard")).toBeInTheDocument()
	})

	it("renders without crashing when no mapping or profiles exist", () => {
		render(<TierApiConfiguration />)

		expect(screen.getByTestId("tier-label-trivial")).toBeInTheDocument()
	})

	it("does not post a message on render (only on explicit change)", () => {
		render(<TierApiConfiguration tierApiConfigs={{ hard: "best-id" }} listApiConfigMeta={listApiConfigMeta} />)

		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	describe("apply recommended mapping (eval harness hook)", () => {
		it("disables the Apply button until JSON is entered", () => {
			render(<TierApiConfiguration tierApiConfigs={{}} listApiConfigMeta={listApiConfigMeta} />)

			expect(screen.getByTestId("apply-tier-recommendation-button")).toBeDisabled()
		})

		it("posts applyTierRecommendations with the parsed tier -> profile-name map", () => {
			render(<TierApiConfiguration tierApiConfigs={{}} listApiConfigMeta={listApiConfigMeta} />)

			fireEvent.change(screen.getByTestId("tier-recommendation-input"), {
				target: { value: '{"trivial": "Cheap Model", "hard": "Best Model"}' },
			})
			fireEvent.click(screen.getByTestId("apply-tier-recommendation-button"))

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "applyTierRecommendations",
				tierRecommendations: { trivial: "Cheap Model", hard: "Best Model" },
			})
		})

		it("shows an error and does not post when the pasted text isn't valid JSON", () => {
			render(<TierApiConfiguration tierApiConfigs={{}} listApiConfigMeta={listApiConfigMeta} />)

			fireEvent.change(screen.getByTestId("tier-recommendation-input"), {
				target: { value: "not json" },
			})
			fireEvent.click(screen.getByTestId("apply-tier-recommendation-button"))

			expect(vscode.postMessage).not.toHaveBeenCalled()
			expect(screen.getByTestId("apply-recommendation-error")).toBeInTheDocument()
		})

		it("shows an error when the pasted JSON isn't an object", () => {
			render(<TierApiConfiguration tierApiConfigs={{}} listApiConfigMeta={listApiConfigMeta} />)

			fireEvent.change(screen.getByTestId("tier-recommendation-input"), {
				target: { value: '["trivial", "hard"]' },
			})
			fireEvent.click(screen.getByTestId("apply-tier-recommendation-button"))

			expect(vscode.postMessage).not.toHaveBeenCalled()
			expect(screen.getByTestId("apply-recommendation-error")).toBeInTheDocument()
		})

		it("surfaces unresolved tiers reported back by the extension host", async () => {
			render(<TierApiConfiguration tierApiConfigs={{}} listApiConfigMeta={listApiConfigMeta} />)

			window.postMessage({ type: "applyTierRecommendationsResult", unresolvedTiers: ["hard"] }, "*")

			expect(await screen.findByTestId("unresolved-tiers")).toBeInTheDocument()
		})
	})
})
