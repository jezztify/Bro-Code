import { memo, useEffect, useState } from "react"

import type { ProviderSettingsEntry } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Button, Textarea } from "@src/components/ui"

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
 *
 * Also hosts the "apply recommended mapping" hook for the headless eval harness
 * (scripts/eval/): pasting its printed `recommendation` JSON (tier -> profile
 * NAME) and applying it sends an `applyTierRecommendations` message, which the
 * extension host resolves to profile ids and merges into the map above.
 */
const TierApiConfiguration = ({ tierApiConfigs = {}, listApiConfigMeta = [] }: TierApiConfigurationProps) => {
	const { t } = useAppTranslation()
	const [recommendationJson, setRecommendationJson] = useState("")
	const [applyError, setApplyError] = useState<string | undefined>(undefined)
	const [unresolvedTiers, setUnresolvedTiers] = useState<string[]>([])

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "applyTierRecommendationsResult") {
				setUnresolvedTiers(message.unresolvedTiers ?? [])
			}
		}
		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [])

	const handleChange = (tier: DifficultyTier, configId: string) => {
		const next = { ...tierApiConfigs }

		if (configId === "-") {
			delete next[tier]
		} else {
			next[tier] = configId
		}

		vscode.postMessage({ type: "tierApiConfigs", tierApiConfigs: next })
	}

	const handleApplyRecommendation = () => {
		setApplyError(undefined)
		setUnresolvedTiers([])

		try {
			const parsed = JSON.parse(recommendationJson)

			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error(t("settings:providers.tierApiConfiguration.applyRecommendation.invalidShape"))
			}

			vscode.postMessage({ type: "applyTierRecommendations", tierRecommendations: parsed })
		} catch (error) {
			setApplyError(error instanceof Error ? error.message : String(error))
		}
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

				<div className="mt-4">
					<label className="block font-medium mb-1">
						{t("settings:providers.tierApiConfiguration.applyRecommendation.label")}
					</label>
					<div className="text-sm text-vscode-descriptionForeground mb-1">
						{t("settings:providers.tierApiConfiguration.applyRecommendation.description")}
					</div>
					<Textarea
						data-testid="tier-recommendation-input"
						value={recommendationJson}
						onChange={(e) => setRecommendationJson(e.target.value)}
						placeholder='{"trivial": "fast-profile", "hard": "strong-profile"}'
						rows={3}
						className="w-full font-mono text-xs"
					/>
					<Button
						className="mt-2"
						size="sm"
						disabled={!recommendationJson.trim()}
						onClick={handleApplyRecommendation}
						data-testid="apply-tier-recommendation-button">
						{t("settings:providers.tierApiConfiguration.applyRecommendation.apply")}
					</Button>
					{applyError && (
						<div
							className="text-sm text-vscode-errorForeground mt-1"
							data-testid="apply-recommendation-error">
							{applyError}
						</div>
					)}
					{unresolvedTiers.length > 0 && (
						<div className="text-sm text-vscode-errorForeground mt-1" data-testid="unresolved-tiers">
							{t("settings:providers.tierApiConfiguration.applyRecommendation.unresolved", {
								tiers: unresolvedTiers.join(", "),
							})}
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}

export default memo(TierApiConfiguration)
