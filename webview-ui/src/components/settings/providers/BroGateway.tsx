import { useEffect, useMemo } from "react"
import {
	type ProviderSettings,
	type OrganizationAllowList,
	type RouterModels,
	broGatewayDefaultModelId,
} from "@bro-code/types"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import { getBroCodeAuthUrl } from "@src/oauth/urls"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { ModelPicker } from "../ModelPicker"
import { ApiErrorMessage } from "../ApiErrorMessage"

type BroGatewayProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
	simplifySettings?: boolean
}

function isClaudeSonnetModelId(id: string) {
	return /claude.*sonnet/i.test(id)
}

// Exported for unit tests. Picks the default Bro Gateway model id, preferring
// Claude Sonnet 4.5 → Sonnet 4 → first available Sonnet → first model overall.
export function pickBroGatewayDefaultModelId(modelIds: string[]) {
	if (modelIds.length === 0) {
		return broGatewayDefaultModelId
	}

	const sonnets = modelIds.filter(isClaudeSonnetModelId)
	if (sonnets.length === 0) {
		return modelIds[0]
	}

	return (
		sonnets.find((id) => id === "anthropic/claude-sonnet-4.5") ??
		sonnets.find((id) => id.includes("claude-sonnet-4.5")) ??
		sonnets.find((id) => /sonnet-4[.-]5/i.test(id)) ??
		sonnets.find((id) => /sonnet-4(?![.-]?\d)/i.test(id)) ??
		sonnets[0]
	)
}

export const BroGateway = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	organizationAllowList,
	modelValidationError,
	simplifySettings,
}: BroGatewayProps) => {
	const { t } = useAppTranslation()
	const { broCodeIsAuthenticated, broCodeUserEmail, broCodeUserName, broCodeBaseUrl, uriScheme, deviceName } =
		useExtensionState()

	const authUrl = getBroCodeAuthUrl(uriScheme, broCodeBaseUrl, deviceName)
	const resolvedDashboardBase = broCodeBaseUrl?.replace(/\/$/, "") || "https://www.brocode.dev"

	const broModels = useMemo(() => routerModels?.["bro-gateway"] ?? {}, [routerModels])
	const modelIds = useMemo(() => Object.keys(broModels), [broModels])
	const resolvedDefaultModelId = useMemo(() => pickBroGatewayDefaultModelId(modelIds), [modelIds])

	useEffect(() => {
		if (modelIds.length === 0) {
			return
		}

		const current = apiConfiguration.broGatewayModelId
		if (!current || !modelIds.includes(current)) {
			setApiConfigurationField("broGatewayModelId", resolvedDefaultModelId)
		}
	}, [apiConfiguration.broGatewayModelId, modelIds, resolvedDefaultModelId, setApiConfigurationField])

	return (
		<>
			<div className="flex flex-col gap-1 rounded-md border border-vscode-panel-border p-2">
				<div className="flex items-center justify-between">
					<label className="block text-sm font-medium">{t("settings:providers.broGateway.account")}</label>
					{broCodeIsAuthenticated && broCodeUserEmail && (
						<span className="text-xs text-vscode-descriptionForeground">{broCodeUserEmail}</span>
					)}
				</div>
				{!broCodeIsAuthenticated ? (
					<div className="flex flex-col gap-1">
						<ApiErrorMessage errorMessage={t("settings:validation.broGatewaySignIn")} />
						<p className="text-xs text-vscode-descriptionForeground">
							{t("settings:providers.broGateway.signInDescription")}
						</p>
						<VSCodeButtonLink href={authUrl} appearance="primary">
							{t("settings:providers.broGateway.signInButton")}
						</VSCodeButtonLink>
					</div>
				) : (
					<div className="flex items-center gap-1">
						<span className="codicon codicon-check text-vscode-charts-green" />
						<span className="text-xs text-vscode-descriptionForeground">
							{broCodeUserName
								? t("settings:providers.broGateway.authenticatedAs", { name: broCodeUserName })
								: t("settings:providers.broGateway.authenticated")}
						</span>
					</div>
				)}
			</div>
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={resolvedDefaultModelId}
				models={broModels}
				modelIdKey="broGatewayModelId"
				serviceName="Bro Gateway"
				serviceUrl={`${resolvedDashboardBase}/dashboard/models`}
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
				simplifySettings={simplifySettings}
			/>
		</>
	)
}
