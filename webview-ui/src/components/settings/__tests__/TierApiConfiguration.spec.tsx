// npx vitest run src/components/settings/__tests__/TierApiConfiguration.spec.tsx

import { render, screen } from "@/utils/test-utils"

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
})
