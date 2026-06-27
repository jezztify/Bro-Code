import { useTranslation } from "react-i18next"

import type { TokenUsage } from "@bro-code/types"

import { formatLargeNumber } from "@src/utils/format"
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
} from "@src/components/ui"

interface TokenBreakdownModalProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	profileBreakdown: NonNullable<TokenUsage["profileBreakdown"]>
}

export const TokenBreakdownModal = ({ open, onOpenChange, profileBreakdown }: TokenBreakdownModalProps) => {
	const { t } = useTranslation()
	const entries = Object.entries(profileBreakdown)

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent onClick={(e) => e.stopPropagation()}>
				<DialogHeader>
					<DialogTitle>{t("chat:tokenBreakdownModal.title")}</DialogTitle>
					<DialogDescription>{t("chat:tokenBreakdownModal.description")}</DialogDescription>
				</DialogHeader>
				<Table>
					<TableBody>
						<TableRow>
							<TableCell className="font-medium">{t("chat:tokenBreakdownModal.profile")}</TableCell>
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
						{entries.map(([profileName, usage]) => (
							<TableRow key={profileName}>
								<TableCell className="font-light">{profileName}</TableCell>
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
