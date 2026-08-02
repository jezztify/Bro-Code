import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { claudeCodeDefaultModelId, claudeCodeModels, type ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button } from "@src/components/ui"
import { vscode } from "@src/utils/vscode"

import { ModelPicker } from "../ModelPicker"

type ClaudeCodeProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => void
	simplifySettings?: boolean
	claudeCodeIsAuthenticated?: boolean
	claudeCodeOAuthState?: {
		status: "idle" | "authorizing" | "authenticated" | "error"
		email?: string
		organizationName?: string
		error?: string
	}
}

// Must match the models AnthropicHandler actually sends the 1M beta flag for,
// otherwise the toggle would be offered where it has no effect.
const ONE_M_CONTEXT_MODELS = ["claude-sonnet-4-20250514", "claude-sonnet-4-5", "claude-sonnet-4-6", "claude-opus-4-6"]

export const ClaudeCode = ({
	apiConfiguration,
	setApiConfigurationField,
	simplifySettings,
	claudeCodeIsAuthenticated = false,
	claudeCodeOAuthState,
}: ClaudeCodeProps) => {
	const { t } = useAppTranslation()

	const selectedModelId = apiConfiguration.apiModelId ?? claudeCodeDefaultModelId
	const supports1MContext = ONE_M_CONTEXT_MODELS.includes(selectedModelId)
	const isAuthorizing = claudeCodeOAuthState?.status === "authorizing"

	const accountLabel = [claudeCodeOAuthState?.email, claudeCodeOAuthState?.organizationName]
		.filter(Boolean)
		.join(" · ")

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2 rounded-md border border-vscode-panel-border p-3">
				{claudeCodeIsAuthenticated ? (
					<div className="flex items-center justify-between gap-2">
						<span className="text-vscode-descriptionForeground">
							{accountLabel || t("settings:providers.claudeCode.authenticated")}
						</span>
						<Button
							variant="secondary"
							size="sm"
							data-testid="claude-code-sign-out"
							onClick={() => vscode.postMessage({ type: "claudeCodeSignOut" })}>
							{t("settings:providers.claudeCode.signOut")}
						</Button>
					</div>
				) : (
					<>
						<Button
							className="w-fit"
							disabled={isAuthorizing}
							data-testid="claude-code-sign-in"
							onClick={() => vscode.postMessage({ type: "claudeCodeSignIn" })}>
							{isAuthorizing
								? t("settings:providers.claudeCode.signingIn")
								: t("settings:providers.claudeCode.signIn")}
						</Button>
						<p className="m-0 text-sm text-vscode-descriptionForeground">
							{t("settings:providers.claudeCode.signInHelp")}
						</p>
					</>
				)}
				{claudeCodeOAuthState?.status === "error" && claudeCodeOAuthState.error && (
					<p className="m-0 text-vscode-errorForeground" data-testid="claude-code-error">
						{claudeCodeOAuthState.error}
					</p>
				)}
			</div>

			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={claudeCodeDefaultModelId}
				models={claudeCodeModels}
				modelIdKey="apiModelId"
				serviceName="Claude Code"
				serviceUrl="https://claude.ai"
				simplifySettings={simplifySettings}
				hidePricing
			/>

			{supports1MContext && (
				<VSCodeCheckbox
					checked={apiConfiguration.claudeCodeBeta1MContext ?? false}
					onChange={(event) =>
						setApiConfigurationField("claudeCodeBeta1MContext", (event.target as HTMLInputElement).checked)
					}
					data-testid="claude-code-1m-context">
					{t("settings:providers.claudeCode.oneMContext")}
				</VSCodeCheckbox>
			)}

			<VSCodeLink href="https://docs.claude.com/en/docs/claude-code">
				{t("settings:providers.claudeCode.docs")}
			</VSCodeLink>
		</div>
	)
}
