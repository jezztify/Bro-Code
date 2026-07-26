// npx vitest run core/prompts/sections/__tests__/modes.spec.ts

import type * as vscode from "vscode"

import type { ModeConfig, CustomModePrompts } from "@bro-code/types"

import { getModesSection } from "../modes"
import { modes } from "../../../../shared/modes"

vi.mock("../../../../utils/globalContext", () => ({
	ensureSettingsDirectoryExists: vi.fn().mockResolvedValue("/mock/settings"),
}))

// Use real built-in slugs so the tests keep working if DEFAULT_MODES changes.
const [firstBuiltIn, secondBuiltIn] = modes.map((m) => m.slug)

const createMockContext = (state: {
	customModes?: ModeConfig[]
	customModePrompts?: CustomModePrompts
}): vscode.ExtensionContext =>
	({
		globalState: {
			get: (key: string) => state[key as keyof typeof state],
			update: vi.fn(),
		},
	}) as unknown as vscode.ExtensionContext

describe("getModesSection", () => {
	it("lists all built-in modes by default", async () => {
		const section = await getModesSection(createMockContext({}))

		for (const mode of modes) {
			expect(section).toContain(`(${mode.slug})`)
		}
	})

	it("excludes a custom mode with includeInSystemPrompt: false", async () => {
		const customModes: ModeConfig[] = [
			{
				slug: "hidden-mode",
				name: "Hidden Mode",
				roleDefinition: "You are hidden.",
				groups: ["read"],
				includeInSystemPrompt: false,
			},
			{
				slug: "visible-mode",
				name: "Visible Mode",
				roleDefinition: "You are visible.",
				groups: ["read"],
			},
		]

		const section = await getModesSection(createMockContext({ customModes }))

		expect(section).not.toContain("hidden-mode")
		expect(section).toContain("(visible-mode)")
	})

	it("excludes a built-in mode disabled via customModePrompts", async () => {
		const customModePrompts: CustomModePrompts = {
			[secondBuiltIn]: { includeInSystemPrompt: false },
		}

		const section = await getModesSection(createMockContext({ customModePrompts }))

		expect(section).not.toContain(`(${secondBuiltIn})`)
		expect(section).toContain(`(${firstBuiltIn})`)
	})

	it("keeps a mode with an explicit includeInSystemPrompt: true", async () => {
		const customModePrompts: CustomModePrompts = {
			[secondBuiltIn]: { includeInSystemPrompt: true },
		}

		const section = await getModesSection(createMockContext({ customModePrompts }))

		expect(section).toContain(`(${secondBuiltIn})`)
	})

	it("excludes a custom mode disabled via customModePrompts overlay", async () => {
		const customModes: ModeConfig[] = [
			{
				slug: "my-mode",
				name: "My Mode",
				roleDefinition: "You are mine.",
				groups: ["read"],
			},
		]
		const customModePrompts: CustomModePrompts = {
			"my-mode": { includeInSystemPrompt: false },
		}

		const section = await getModesSection(createMockContext({ customModes, customModePrompts }))

		expect(section).not.toContain("my-mode")
	})
})
