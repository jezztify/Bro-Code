import { memo } from "react"

import type { ProviderSettingsEntry } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

const DIFFICULTY_TIERS = ["trivial", "standard", "hard"] as const
type DifficultyTier = (typeof DIFFICULTY_TIERS)[number]

interface TierApiConfigurationProps {
	tierApiConfigs?: Record<string, string>
	listApiConfigMeta?: ProviderSettingsEntry[]
}

/**
 * Settings -> Providers section mapping each `new_task` difficulty tier
 * ("trivial" | "standard" | "hard") to a provider profile. Resolution order at
 * task-creation time (see `ClineProvider#activateTierProfileIfConfigured`):
 * tier's mapped profile (if set) -> the target mode's own configured profile ->
 * the global default profile.
 */
const TierApiConfiguration = ({ tierApiConfigs = {}, listApiConfigMeta = [] }: TierApiConfigurationProps) => {
	const { t } = useAppTranslation()

	const handleChange = (tier: DifficultyTier, configId: string) => {
		const next = { ...tierApiConfigs }

		if (configId === "-") {
			delete next[tier]
		} else {
			next[tier] = configId
		}

		vscode.postMessage({ type: "tierApiConfigs", tierApiConfigs: next })
	}

	return (
		<div>
			<SectionHeader description={t("settings:providers.tierApiConfiguration.description")}>
				{t("settings:providers.tierApiConfiguration.title")}
			</SectionHeader>
			<Section>
				<div className="flex flex-col gap-3">
					{DIFFICULTY_TIERS.map((tier) => (
						<div key={tier} className="flex items-center gap-3">
							<label className="w-24 font-medium" data-testid={`tier-label-${tier}`}>
								{t(`settings:providers.tierApiConfiguration.tiers.${tier}`)}
							</label>
							<Select
								value={tierApiConfigs[tier] || "-"}
								onValueChange={(value) => handleChange(tier, value)}>
								<SelectTrigger data-testid={`tier-api-config-select-${tier}`} className="grow">
									<SelectValue
										placeholder={t("settings:providers.tierApiConfiguration.useModeDefault")}
									/>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="-">
										{t("settings:providers.tierApiConfiguration.useModeDefault")}
									</SelectItem>
									{listApiConfigMeta.map((config) => (
										<SelectItem key={config.id} value={config.id}>
											{config.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					))}
				</div>
			</Section>
		</div>
	)
}

export default memo(TierApiConfiguration)
