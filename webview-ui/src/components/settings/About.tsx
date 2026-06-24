import { HTMLAttributes, useEffect, useState } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Trans } from "react-i18next"
import { ArrowRightLeft, Download, Upload, TriangleAlert, Bug, Lightbulb, Shield, MessagesSquare } from "lucide-react"
import { VSCodeButton, VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import type { ExtensionMessage, TelemetrySetting } from "@bro-code/types"

import { Package } from "@bro/package"

import { vscode } from "@/utils/vscode"
import { EXTERNAL_LINKS } from "@/constants/externalLinks"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui"

import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"

type BroHistoryImportProgress = NonNullable<ExtensionMessage["broHistoryImportProgress"]>

type AboutProps = HTMLAttributes<HTMLDivElement> & {
	telemetrySetting: TelemetrySetting
	setTelemetrySetting: (setting: TelemetrySetting) => void
	debug?: boolean
	setDebug?: (debug: boolean) => void
}

export const About = ({ telemetrySetting, setTelemetrySetting, debug, setDebug, className, ...props }: AboutProps) => {
	const { t } = useAppTranslation()
	const [broHistoryImportProgress, setBroHistoryImportProgress] = useState<BroHistoryImportProgress | null>(null)

	useEffect(() => {
		const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
			const message = event.data
			if (message.type !== "broHistoryImportProgress" || !message.broHistoryImportProgress) {
				return
			}

			const progress = message.broHistoryImportProgress
			if (progress.status === "finished" && progress.totalFileCount === 0) {
				setBroHistoryImportProgress(null)
				return
			}

			setBroHistoryImportProgress(progress)
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	const isImporting =
		broHistoryImportProgress?.status === "starting" || broHistoryImportProgress?.status === "copying"
	const isImportFailed = broHistoryImportProgress?.status === "failed"
	const isImportSuccessful =
		broHistoryImportProgress?.status === "finished" && broHistoryImportProgress.totalFileCount > 0
	const shouldShowImportProgress = !!broHistoryImportProgress && (isImporting || isImportFailed || isImportSuccessful)
	const importProgressPercent =
		broHistoryImportProgress && broHistoryImportProgress.totalFileCount > 0
			? Math.round((broHistoryImportProgress.copiedFileCount / broHistoryImportProgress.totalFileCount) * 100)
			: 0
	const importProgressSummary = !broHistoryImportProgress
		? ""
		: isImportFailed
			? broHistoryImportProgress.totalFileCount > 0
				? t("settings:about.broHistoryImport.summaryFailedWithFiles", {
						copied: broHistoryImportProgress.copiedFileCount,
						total: broHistoryImportProgress.totalFileCount,
					})
				: t("settings:about.broHistoryImport.summaryFailedNoFiles")
			: t("settings:about.broHistoryImport.summaryCopied", {
					copied: broHistoryImportProgress.copiedFileCount,
					total: broHistoryImportProgress.totalFileCount,
				})
	const importProgressDetail = isImportFailed
		? t("settings:about.broHistoryImport.detailFailed")
		: broHistoryImportProgress && broHistoryImportProgress.importedTaskCount > 0
			? t("settings:about.broHistoryImport.detailTasksImported", {
					count: broHistoryImportProgress.importedTaskCount,
					total: broHistoryImportProgress.totalTaskCount,
				})
			: t("settings:about.broHistoryImport.detailPreparing")

	const handleImportBroHistory = () => {
		setBroHistoryImportProgress({
			status: "starting",
			copiedFileCount: 0,
			totalFileCount: 0,
			importedTaskCount: 0,
			totalTaskCount: 0,
		})
		vscode.postMessage({ type: "importBroHistory" })
	}

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>{t("settings:sections.about")}</SectionHeader>

			<Section>
				<p>
					{Package.sha
						? `Version: ${Package.version} (${Package.sha.slice(0, 8)})`
						: `Version: ${Package.version}`}
				</p>
				<SearchableSetting
					settingId="about-telemetry"
					section="about"
					label={t("settings:footer.telemetry.label")}>
					<VSCodeCheckbox
						checked={telemetrySetting !== "disabled"}
						onChange={(e: any) => {
							const checked = e.target.checked === true
							setTelemetrySetting(checked ? "enabled" : "disabled")
						}}>
						{t("settings:footer.telemetry.label")}
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						<Trans
							i18nKey="settings:footer.telemetry.description"
							components={{
								privacyLink: <VSCodeLink href="https://www.brocode.dev/privacy" />,
							}}
						/>
					</p>
				</SearchableSetting>
			</Section>

			<Section className="space-y-0">
				<h3>{t("settings:about.contactAndCommunity")}</h3>
				<div className="flex flex-col gap-3">
					<div className="flex items-start gap-2">
						<Bug className="size-4 text-vscode-descriptionForeground shrink-0" />
						<span>
							{t("settings:about.bugReport.label")}{" "}
							<VSCodeLink href={EXTERNAL_LINKS.BUG_REPORT}>
								{t("settings:about.bugReport.link")}
							</VSCodeLink>
						</span>
					</div>
					<div className="flex items-start gap-2">
						<Lightbulb className="size-4 text-vscode-descriptionForeground shrink-0" />
						<span>
							{t("settings:about.featureRequest.label")}{" "}
							<VSCodeLink href={EXTERNAL_LINKS.FEATURE_REQUEST}>
								{t("settings:about.featureRequest.link")}
							</VSCodeLink>
						</span>
					</div>
					<div className="flex items-start gap-2">
						<Shield className="size-4 text-vscode-descriptionForeground shrink-0" />
						<span>
							{t("settings:about.securityIssue.label")}{" "}
							<VSCodeLink href={EXTERNAL_LINKS.SECURITY_POLICY}>
								{t("settings:about.securityIssue.link")}
							</VSCodeLink>
						</span>
					</div>
					<div className="flex items-start gap-2">
						<MessagesSquare className="size-4 text-vscode-descriptionForeground shrink-0" />
						<span>
							<Trans
								i18nKey="settings:about.community"
								components={{
									redditLink: <VSCodeLink href={EXTERNAL_LINKS.REDDIT} />,
									discordLink: <VSCodeLink href={EXTERNAL_LINKS.DISCORD} />,
								}}
							/>
						</span>
					</div>
					{setDebug && (
						<SearchableSetting
							settingId="about-debug-mode"
							section="about"
							label={t("settings:about.debugMode.label")}
							className="mt-4 pt-4 border-t border-vscode-settings-headerBorder">
							<VSCodeCheckbox
								checked={debug ?? false}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									setDebug(checked)
								}}>
								{t("settings:about.debugMode.label")}
							</VSCodeCheckbox>
							<p className="text-vscode-descriptionForeground text-sm mt-0">
								{t("settings:about.debugMode.description")}
							</p>
						</SearchableSetting>
					)}
				</div>
			</Section>

			<Section className="space-y-0">
				<SearchableSetting
					settingId="about-manage-settings"
					section="about"
					label={t("settings:about.manageSettings")}>
					<h3>{t("settings:about.manageSettings")}</h3>
					<div className="flex flex-wrap items-center gap-2">
						<Button onClick={() => vscode.postMessage({ type: "exportSettings" })} className="w-28">
							<Upload className="p-0.5" />
							{t("settings:footer.settings.export")}
						</Button>
						<Button onClick={() => vscode.postMessage({ type: "importSettings" })} className="w-28">
							<Download className="p-0.5" />
							{t("settings:footer.settings.import")}
						</Button>
						<Button
							variant="destructive"
							onClick={() => vscode.postMessage({ type: "resetState" })}
							className="w-28">
							<TriangleAlert className="p-0.5" />
							{t("settings:footer.settings.reset")}
						</Button>
					</div>
				</SearchableSetting>
			</Section>

			<Section className="space-y-0">
				<SearchableSetting
					settingId="about-import-bro-history"
					section="about"
					label={t("settings:about.broHistoryImport.settingLabel")}>
					<div className="space-y-3 rounded-lg border border-vscode-focusBorder/40 bg-vscode-editorWidget-background/40 p-3">
						<div className="flex items-start gap-3">
							<div className="rounded-md border border-vscode-focusBorder/30 bg-vscode-button-background/15 p-2 text-vscode-button-background">
								<ArrowRightLeft className="size-4" />
							</div>
							<div className="min-w-0">
								<div className="text-sm font-medium text-vscode-foreground">
									{t("settings:about.broHistoryImport.cardTitle")}
								</div>
								<div className="text-sm leading-5 text-vscode-descriptionForeground">
									{t("settings:about.broHistoryImport.cardDescription")}
								</div>
							</div>
						</div>
						{shouldShowImportProgress && (
							<div className="space-y-2 rounded-md border border-vscode-focusBorder/25 bg-vscode-editor-background/70 p-3">
								<div className="flex items-center justify-between gap-3 text-sm" aria-live="polite">
									<div className="flex items-center gap-2 text-vscode-foreground">
										{isImporting ? (
											<span className="codicon codicon-loading codicon-modifier-spin text-vscode-button-background" />
										) : isImportFailed ? (
											<span className="codicon codicon-error text-[var(--vscode-testing-iconFailed)]" />
										) : (
											<span className="codicon codicon-check text-[var(--vscode-testing-iconPassed)]" />
										)}
										<span className="font-medium">
											{isImporting
												? t("settings:about.broHistoryImport.statusImporting")
												: isImportFailed
													? t("settings:about.broHistoryImport.statusFailed")
													: t("settings:about.broHistoryImport.statusComplete")}
										</span>
									</div>
									<div className="text-sm font-medium text-vscode-descriptionForeground">
										{importProgressPercent}%
									</div>
								</div>
								<div
									className="h-2 overflow-hidden rounded-full bg-[var(--vscode-editorWidget-border)]"
									role="progressbar"
									aria-label={t("settings:about.broHistoryImport.progressAriaLabel")}
									aria-valuemin={0}
									aria-valuemax={100}
									aria-valuenow={importProgressPercent}>
									<div
										className={cn(
											"h-full rounded-full transition-[width] duration-200",
											isImporting
												? "bg-[var(--vscode-progressBar-background)]"
												: isImportFailed
													? "bg-[var(--vscode-testing-iconFailed)]"
													: "bg-[var(--vscode-testing-iconPassed)]",
										)}
										style={{ width: `${importProgressPercent}%` }}
									/>
								</div>
								<div className="space-y-1 text-xs">
									<div className="text-vscode-foreground">{importProgressSummary}</div>
									<div className="text-vscode-descriptionForeground">{importProgressDetail}</div>
								</div>
							</div>
						)}
						<VSCodeButton
							appearance="primary"
							disabled={isImporting}
							onClick={handleImportBroHistory}
							style={{ width: "100%" }}>
							{isImporting
								? t("settings:about.broHistoryImport.buttonImporting")
								: t("settings:about.broHistoryImport.buttonIdle")}
						</VSCodeButton>
					</div>
				</SearchableSetting>
			</Section>
		</div>
	)
}
