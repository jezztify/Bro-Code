// npx vitest run src/__tests__/index.test.ts

import { generatePackageJson } from "../index.js"

describe("generatePackageJson", () => {
	it("should be a test", () => {
		const generatedPackageJson = generatePackageJson({
			packageJson: {
				name: "bro-cline",
				displayName: "%extension.displayName%",
				description: "%extension.description%",
				publisher: "BroVeterinaryInc",
				version: "3.17.2",
				icon: "assets/icons/icon.png",
				contributes: {
					viewsContainers: {
						activitybar: [
							{
								id: "bro-cline-ActivityBar",
								title: "%views.activitybar.title%",
								icon: "assets/icons/icon.svg",
							},
						],
					},
					views: {
						"bro-cline-ActivityBar": [
							{
								type: "webview",
								id: "bro-cline.SidebarProvider",
								name: "",
							},
						],
					},
					commands: [
						{
							command: "bro-cline.plusButtonClicked",
							title: "%command.newTask.title%",
							icon: "$(edit)",
						},
						{
							command: "bro-cline.openInNewTab",
							title: "%command.openInNewTab.title%",
							category: "%configuration.title%",
						},
					],
					menus: {
						"editor/context": [
							{
								submenu: "bro-cline.contextMenu",
								group: "navigation",
							},
						],
						"bro-cline.contextMenu": [
							{
								command: "bro-cline.addToContext",
								group: "1_actions@1",
							},
						],
						"editor/title": [
							{
								command: "bro-cline.plusButtonClicked",
								group: "navigation@1",
								when: "activeWebviewPanelId == bro-cline.TabPanelProvider",
							},
							{
								command: "bro-cline.settingsButtonClicked",
								group: "navigation@6",
								when: "activeWebviewPanelId == bro-cline.TabPanelProvider",
							},
							{
								command: "bro-cline.accountButtonClicked",
								group: "navigation@6",
								when: "activeWebviewPanelId == bro-cline.TabPanelProvider",
							},
						],
					},
					submenus: [
						{
							id: "bro-cline.contextMenu",
							label: "%views.contextMenu.label%",
						},
						{
							id: "bro-cline.terminalMenu",
							label: "%views.terminalMenu.label%",
						},
					],
					configuration: {
						title: "%configuration.title%",
						properties: {
							"bro-cline.allowedCommands": {
								type: "array",
								items: {
									type: "string",
								},
								default: ["npm test", "npm install", "tsc", "git log", "git diff", "git show"],
								description: "%commands.allowedCommands.description%",
							},
							"bro-cline.customStoragePath": {
								type: "string",
								default: "",
								description: "%settings.customStoragePath.description%",
							},
						},
					},
				},
				scripts: {
					lint: "eslint **/*.ts",
				},
			},
			overrideJson: {
				name: "bro-code-nightly",
				displayName: "Bro Code Nightly",
				publisher: "BroCodeOrganization",
				version: "0.0.1",
				icon: "assets/icons/icon-nightly.png",
				scripts: {},
			},
			substitution: ["bro-cline", "bro-code-nightly"],
		})

		expect(generatedPackageJson).toStrictEqual({
			name: "bro-code-nightly",
			displayName: "Bro Code Nightly",
			description: "%extension.description%",
			publisher: "BroCodeOrganization",
			version: "0.0.1",
			icon: "assets/icons/icon-nightly.png",
			contributes: {
				viewsContainers: {
					activitybar: [
						{
							id: "bro-code-nightly-ActivityBar",
							title: "%views.activitybar.title%",
							icon: "assets/icons/icon.svg",
						},
					],
				},
				views: {
					"bro-code-nightly-ActivityBar": [
						{
							type: "webview",
							id: "bro-code-nightly.SidebarProvider",
							name: "",
						},
					],
				},
				commands: [
					{
						command: "bro-code-nightly.plusButtonClicked",
						title: "%command.newTask.title%",
						icon: "$(edit)",
					},
					{
						command: "bro-code-nightly.openInNewTab",
						title: "%command.openInNewTab.title%",
						category: "%configuration.title%",
					},
				],
				menus: {
					"editor/context": [
						{
							submenu: "bro-code-nightly.contextMenu",
							group: "navigation",
						},
					],
					"bro-code-nightly.contextMenu": [
						{
							command: "bro-code-nightly.addToContext",
							group: "1_actions@1",
						},
					],
					"editor/title": [
						{
							command: "bro-code-nightly.plusButtonClicked",
							group: "navigation@1",
							when: "activeWebviewPanelId == bro-code-nightly.TabPanelProvider",
						},
						{
							command: "bro-code-nightly.settingsButtonClicked",
							group: "navigation@6",
							when: "activeWebviewPanelId == bro-code-nightly.TabPanelProvider",
						},
						{
							command: "bro-code-nightly.accountButtonClicked",
							group: "navigation@6",
							when: "activeWebviewPanelId == bro-code-nightly.TabPanelProvider",
						},
					],
				},
				submenus: [
					{
						id: "bro-code-nightly.contextMenu",
						label: "%views.contextMenu.label%",
					},
					{
						id: "bro-code-nightly.terminalMenu",
						label: "%views.terminalMenu.label%",
					},
				],
				configuration: {
					title: "%configuration.title%",
					properties: {
						"bro-code-nightly.allowedCommands": {
							type: "array",
							items: {
								type: "string",
							},
							default: ["npm test", "npm install", "tsc", "git log", "git diff", "git show"],
							description: "%commands.allowedCommands.description%",
						},
						"bro-code-nightly.customStoragePath": {
							type: "string",
							default: "",
							description: "%settings.customStoragePath.description%",
						},
					},
				},
			},
			scripts: {},
		})
	})
})
