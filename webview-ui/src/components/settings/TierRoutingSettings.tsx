import { useEffect, useState } from "react"

import type { ProviderSettingsEntry } from "@bro-code/types"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Button, Textarea } from "@src/components/ui"

import { Section } from "./Section"

const TIERS = ["trivial", "standard", "hard"] as const

interface TierRoutingSettingsProps {
	listApiConfigMeta: ProviderSettingsEntry[]
	tierApiConfigs: Record<string, string>
	setTierApiConfigs: (value: Record<string, string>) => void
}

export const TierRoutingSettings = ({
	listApiConfigMeta,
	tierApiConfigs,
	setTierApiConfigs,
}: TierRoutingSettingsProps) => {
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

	const handleChange = (tier: string, configId: string) => {
		const next = { ...tierApiConfigs }
		if (configId === "-") {
			delete next[tier]
		} else {
			next[tier] = configId
		}
		setTierApiConfigs(next)
		vscode.postMessage({ type: "tierApiConfigs", tierApiConfigs: next })
	}

	const handleApplyRecommendation = () => {
		setApplyError(undefined)
		setUnresolvedTiers([])
		try {
			const parsed = JSON.parse(recommendationJson)
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error("Expected a JSON object of tier -> profile name")
			}
			vscode.postMessage({ type: "applyTierRecommendations", tierRecommendations: parsed })
		} catch (error) {
			setApplyError(error instanceof Error ? error.message : String(error))
		}
	}

	return (
		<Section>
			<div className="font-medium">{t("settings:tierRouting.title")}</div>
			<div className="text-sm text-vscode-descriptionForeground">{t("settings:tierRouting.description")}</div>
			{TIERS.map((tier) => (
				<div key={tier}>
					<label className="block font-medium mb-1">{t(`settings:tierRouting.tiers.${tier}`)}</label>
					<Select value={tierApiConfigs[tier] || "-"} onValueChange={(value) => handleChange(tier, value)}>
						<SelectTrigger data-testid={`tier-${tier}-select`} className="w-full">
							<SelectValue placeholder={t("settings:tierRouting.useModeDefault")} />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="-">{t("settings:tierRouting.useModeDefault")}</SelectItem>
							{listApiConfigMeta.map((config) => (
								<SelectItem key={config.id} value={config.id} data-testid={`${config.id}-option`}>
									{config.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			))}
			<div>
				<label className="block font-medium mb-1">{t("settings:tierRouting.applyRecommendation.label")}</label>
				<div className="text-sm text-vscode-descriptionForeground mb-1">
					{t("settings:tierRouting.applyRecommendation.description")}
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
					onClick={handleApplyRecommendation}>
					{t("settings:tierRouting.applyRecommendation.apply")}
				</Button>
				{applyError && <div className="text-sm text-vscode-errorForeground mt-1">{applyError}</div>}
				{unresolvedTiers.length > 0 && (
					<div className="text-sm text-vscode-errorForeground mt-1">
						{t("settings:tierRouting.applyRecommendation.unresolved", {
							tiers: unresolvedTiers.join(", "),
						})}
					</div>
				)}
			</div>
		</Section>
	)
}

export default TierRoutingSettings
