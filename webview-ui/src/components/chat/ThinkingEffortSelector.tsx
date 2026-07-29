import React from "react"
import { Check, ChevronDown } from "lucide-react"

import {
	reasoningEfforts,
	type ReasoningEffortOverride,
} from "@roo-code/types"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"
import { Popover, PopoverContent, PopoverTrigger, StandardTooltip } from "@src/components/ui"
import { useRooPortal } from "@src/components/ui/hooks/useRooPortal"
import { useSelectedModel } from "@src/components/ui/hooks/useSelectedModel"

type ThinkingEffortValue = ReasoningEffortOverride | null

type ThinkingEffortOption = {
	value: ReasoningEffortOverride
	label: string
}

interface ThinkingEffortSelectorProps {
	value: ThinkingEffortValue
	onChange: (value: ThinkingEffortValue) => void
	disabled?: boolean
	triggerClassName?: string
}

const getAvailableEfforts = (supports: boolean | readonly ReasoningEffortOverride[] | undefined): ReasoningEffortOverride[] => {
	if (supports === true) {
		return [...reasoningEfforts]
	}

	return Array.isArray(supports) ? [...supports] : []
}

export const ThinkingEffortSelector = ({
	value,
	onChange,
	disabled = false,
	triggerClassName = "",
}: ThinkingEffortSelectorProps) => {
	const { t } = useAppTranslation()
	const { apiConfiguration } = useExtensionState()
	const { info } = useSelectedModel(apiConfiguration)
	const portalContainer = useRooPortal("roo-portal")
	const [open, setOpen] = React.useState(false)
	const selectedItemRef = React.useRef<HTMLDivElement>(null)
	const scrollContainerRef = React.useRef<HTMLDivElement>(null)

	const options = React.useMemo<ThinkingEffortOption[]>(() => {
		const supports = info?.supportsReasoningEffort
		const efforts = getAvailableEfforts(supports)

		if (supports === true && !info?.requiredReasoningEffort) {
			efforts.push("disable")
		}

		// A required model must never receive an explicit Off override. Explicit
		// capability arrays remain authoritative for every enabled effort value.
		const filteredEfforts = info?.requiredReasoningEffort
			? efforts.filter((effort) => effort !== "disable")
			: efforts

		return filteredEfforts.map((effort) => ({
			value: effort,
			label:
				effort === "disable"
					? t("chat:thinkingEffort.disable")
					: t(`chat:thinkingEffort.${effort}`),
		}))
	}, [info, t])

	const isVisible = !!info && options.length > 0

	React.useEffect(() => {
		if (isVisible && value !== null && !options.some((option) => option.value === value)) {
			onChange(null)
		}
	}, [isVisible, onChange, options, value])

	React.useEffect(() => {
		if (!open) {
			return
		}

		requestAnimationFrame(() => {
			if (!selectedItemRef.current || !scrollContainerRef.current) {
				return
			}

			const container = scrollContainerRef.current
			const item = selectedItemRef.current
			const maxScroll = container.scrollHeight - container.clientHeight
			const scrollPosition = item.offsetTop - container.clientHeight / 2 + item.offsetHeight / 2

			container.scrollTo({
				top: Math.min(Math.max(0, scrollPosition), maxScroll),
				behavior: "instant",
			})
		})
	}, [open, value])

	if (!isVisible) {
		return null
	}

	const selectedOption = value === null ? undefined : options.find((option) => option.value === value)
	const selectedLabel = selectedOption?.label ?? t("chat:thinkingEffort.default")

	return (
		<Popover open={open} onOpenChange={setOpen} data-testid="thinking-effort-selector-root">
			<StandardTooltip content={t("chat:thinkingEffort.title")}>
				<PopoverTrigger
					disabled={disabled}
					aria-label={t("chat:thinkingEffort.title")}
					data-testid="thinking-effort-selector-trigger"
					className={cn(
						"inline-flex items-center relative whitespace-nowrap px-1.5 py-1 text-xs",
						"bg-transparent border border-[rgba(255,255,255,0.08)] rounded-md text-vscode-foreground",
						"transition-all duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder focus-visible:ring-inset",
						disabled
							? "opacity-50 cursor-not-allowed"
							: "opacity-90 hover:opacity-100 hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)] cursor-pointer",
						triggerClassName,
					)}>
					<span className="truncate">{selectedLabel}</span>
					<ChevronDown className="ml-1 size-3.5 shrink-0 opacity-70" />
				</PopoverTrigger>
			</StandardTooltip>
			<PopoverContent
				align="start"
				sideOffset={4}
				container={portalContainer}
				className="p-0 overflow-hidden min-w-52 max-w-9/10"
				data-testid="thinking-effort-selector-content">
				<div className="flex flex-col w-full">
					<div className="p-3 border-b border-vscode-dropdown-border">
						<p className="m-0 text-xs text-vscode-descriptionForeground">
							{t("chat:thinkingEffort.description")}
						</p>
					</div>
					<div ref={scrollContainerRef} className="max-h-[300px] overflow-y-auto">
						<div className="py-1">
							<div
								ref={value === null ? selectedItemRef : null}
								onClick={() => {
									onChange(null)
									setOpen(false)
								}}
								className={cn(
									"px-3 py-1.5 text-sm cursor-pointer flex items-center",
									"hover:bg-vscode-list-hoverBackground",
									value === null
										? "bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground"
										: "",
								)}
								data-testid="thinking-effort-selector-item-default">
								<span className="flex-1 min-w-0">{t("chat:thinkingEffort.default")}</span>
								{value === null && <Check className="ml-auto size-4 p-0.5" />}
							</div>
							{options.map((option) => {
								const isSelected = option.value === value
								return (
									<div
										key={option.value}
										ref={isSelected ? selectedItemRef : null}
										onClick={() => {
											onChange(option.value)
											setOpen(false)
										}}
										className={cn(
											"px-3 py-1.5 text-sm cursor-pointer flex items-center",
											"hover:bg-vscode-list-hoverBackground",
											isSelected
												? "bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground"
												: "",
										)}
										data-testid={`thinking-effort-selector-item-${option.value}`}>
										<span className="flex-1 min-w-0">{option.label}</span>
										{isSelected && <Check className="ml-auto size-4 p-0.5" />}
									</div>
								)
							})}
						</div>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
}
