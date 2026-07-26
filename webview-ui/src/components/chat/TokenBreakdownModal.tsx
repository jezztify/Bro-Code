import { useState } from "react"
import { useTranslation } from "react-i18next"

import type { TokenUsage } from "@roo-code/types"

import { formatLargeNumber } from "@src/utils/format"
import { cn } from "@src/lib/utils"
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	Table,
	TableBody,
	TableRow,
	TableCell,
	Button,
} from "@src/components/ui"

type BreakdownView = "model" | "profile"

interface TokenBreakdownModalProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	profileBreakdown?: TokenUsage["profileBreakdown"]
	modelBreakdown?: TokenUsage["modelBreakdown"]
}

export const TokenBreakdownModal = ({
	open,
	onOpenChange,
	profileBreakdown,
	modelBreakdown,
}: TokenBreakdownModalProps) => {
	const { t } = useTranslation()
	const hasModelBreakdown = !!modelBreakdown && Object.keys(modelBreakdown).length > 0
	const hasProfileBreakdown = !!profileBreakdown && Object.keys(profileBreakdown).length > 0
	const [view, setView] = useState<BreakdownView>(hasModelBreakdown ? "model" : "profile")

	const breakdown = view === "model" ? modelBreakdown : profileBreakdown
	const entries = Object.entries(breakdown ?? {})

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent onClick={(e) => e.stopPropagation()}>
				<DialogHeader>
					<DialogTitle>
						{view === "model"
							? t("chat:tokenBreakdownModal.titleByModel")
							: t("chat:tokenBreakdownModal.titleByProfile")}
					</DialogTitle>
					<DialogDescription>
						{view === "model"
							? t("chat:tokenBreakdownModal.descriptionByModel")
							: t("chat:tokenBreakdownModal.descriptionByProfile")}
					</DialogDescription>
				</DialogHeader>
				{hasModelBreakdown && hasProfileBreakdown && (
					<div className="flex gap-1">
						<Button
							size="sm"
							variant={view === "model" ? "secondary" : "ghost"}
							className={cn(view !== "model" && "opacity-70")}
							onClick={() => setView("model")}>
							{t("chat:tokenBreakdownModal.viewByModel")}
						</Button>
						<Button
							size="sm"
							variant={view === "profile" ? "secondary" : "ghost"}
							className={cn(view !== "profile" && "opacity-70")}
							onClick={() => setView("profile")}>
							{t("chat:tokenBreakdownModal.viewByProfile")}
						</Button>
					</div>
				)}
				<Table>
					<TableBody>
						<TableRow>
							<TableCell className="font-medium">
								{view === "model"
									? t("chat:tokenBreakdownModal.model")
									: t("chat:tokenBreakdownModal.profile")}
							</TableCell>
							<TableCell className="font-medium text-right">
								{t("chat:tokenBreakdownModal.tokensIn")}
							</TableCell>
							<TableCell className="font-medium text-right">
								{t("chat:tokenBreakdownModal.tokensOut")}
							</TableCell>
							<TableCell className="font-medium text-right">
								{t("chat:tokenBreakdownModal.cost")}
							</TableCell>
						</TableRow>
						{entries.map(([name, usage]) => (
							<TableRow key={name}>
								<TableCell className="font-light">{name}</TableCell>
								<TableCell className="font-mono text-right">
									{formatLargeNumber(usage.tokensIn)}
								</TableCell>
								<TableCell className="font-mono text-right">
									{formatLargeNumber(usage.tokensOut)}
								</TableCell>
								<TableCell className="font-mono text-right">${usage.cost.toFixed(2)}</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</DialogContent>
		</Dialog>
	)
}
