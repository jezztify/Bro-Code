import { memo, useEffect, useRef, useState } from "react"
import { VSCodeTextField, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import {
	type SearchableSelectOption,
	Button,
	Input,
	Dialog,
	DialogContent,
	DialogTitle,
	StandardTooltip,
	SearchableSelect,
} from "@src/components/ui"

interface ConfigurationSetSummary {
	id: string
	name: string
}

interface ConfigurationSetManagerProps {
	activeConfigurationSetId?: string
	configurationSets?: ConfigurationSetSummary[]
	onSelectSet: (id: string) => void
	onCreateSet: (name: string, seedFromCurrent: boolean) => void
	onRenameSet: (id: string, newName: string) => void
	onDeleteSet: (id: string) => void
}

/**
 * Settings -> Modes entry point for switching between named "configuration sets" -
 * each a complete mode -> provider-profile mapping - as a single action, and for
 * creating/renaming/deleting them. The active set is tracked per VS Code workspace
 * (see `ClineProvider#applyModeApiConfig` and the `activeConfigurationSetId`
 * workspace-state key); only the set *definitions* themselves are shared globally.
 */
const ConfigurationSetManager = ({
	activeConfigurationSetId = "",
	configurationSets = [],
	onSelectSet,
	onCreateSet,
	onRenameSet,
	onDeleteSet,
}: ConfigurationSetManagerProps) => {
	const { t } = useAppTranslation()

	const [isRenaming, setIsRenaming] = useState(false)
	const [isCreating, setIsCreating] = useState(false)
	const [inputValue, setInputValue] = useState("")
	const [newSetName, setNewSetName] = useState("")
	const [seedFromCurrent, setSeedFromCurrent] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const inputRef = useRef<any>(null)
	const newSetInputRef = useRef<any>(null)

	const activeSet = configurationSets.find((set) => set.id === activeConfigurationSetId)

	const validateName = (name: string, isNewSet: boolean): string | null => {
		const trimmed = name.trim()
		if (!trimmed) return t("prompts:configurationSet.nameEmpty")

		const nameExists = configurationSets.some((set) => set.name.toLowerCase() === trimmed.toLowerCase())

		if (isNewSet && nameExists) {
			return t("prompts:configurationSet.nameExists")
		}

		if (!isNewSet && nameExists && trimmed.toLowerCase() !== activeSet?.name.toLowerCase()) {
			return t("prompts:configurationSet.nameExists")
		}

		return null
	}

	const resetCreateState = () => {
		setIsCreating(false)
		setNewSetName("")
		setSeedFromCurrent(true)
		setError(null)
	}

	const resetRenameState = () => {
		setIsRenaming(false)
		setInputValue("")
		setError(null)
	}

	useEffect(() => {
		if (isRenaming) {
			const timeoutId = setTimeout(() => inputRef.current?.focus(), 0)
			return () => clearTimeout(timeoutId)
		}
	}, [isRenaming])

	useEffect(() => {
		if (isCreating) {
			const timeoutId = setTimeout(() => newSetInputRef.current?.focus(), 0)
			return () => clearTimeout(timeoutId)
		}
	}, [isCreating])

	useEffect(() => {
		resetCreateState()
		resetRenameState()
	}, [activeConfigurationSetId])

	const handleSelectSet = (id: string) => {
		if (!id) return
		onSelectSet(id)
	}

	const handleAdd = () => {
		resetCreateState()
		setIsCreating(true)
	}

	const handleStartRename = () => {
		setIsRenaming(true)
		setInputValue(activeSet?.name || "")
		setError(null)
	}

	const handleCancel = () => {
		resetRenameState()
	}

	const handleSave = () => {
		const trimmedValue = inputValue.trim()
		const validationError = validateName(trimmedValue, false)

		if (validationError) {
			setError(validationError)
			return
		}

		if (isRenaming && activeSet) {
			if (activeSet.name === trimmedValue) {
				resetRenameState()
				return
			}
			onRenameSet(activeSet.id, trimmedValue)
		}

		resetRenameState()
	}

	const handleNewSetSave = () => {
		const trimmedValue = newSetName.trim()
		const validationError = validateName(trimmedValue, true)

		if (validationError) {
			setError(validationError)
			return
		}

		onCreateSet(trimmedValue, seedFromCurrent)
		resetCreateState()
	}

	const handleDelete = () => {
		if (!activeConfigurationSetId || configurationSets.length <= 1) return
		onDeleteSet(activeConfigurationSetId)
	}

	const isOnlySet = configurationSets.length === 1

	return (
		<div className="flex flex-col gap-1">
			<label className="block font-medium mb-1">{t("prompts:configurationSet.title")}</label>

			{isRenaming ? (
				<div data-testid="rename-set-form">
					<div className="flex items-center gap-1">
						<VSCodeTextField
							ref={inputRef}
							value={inputValue}
							onInput={(e: unknown) => {
								const target = e as { target: { value: string } }
								setInputValue(target.target.value)
								setError(null)
							}}
							placeholder={t("prompts:configurationSet.enterNewSetName")}
							onKeyDown={({ key }) => {
								if (key === "Enter" && inputValue.trim()) {
									handleSave()
								} else if (key === "Escape") {
									handleCancel()
								}
							}}
							className="grow"
						/>
						<StandardTooltip content={t("settings:common.save")}>
							<Button
								variant="ghost"
								size="icon"
								disabled={!inputValue.trim()}
								onClick={handleSave}
								data-testid="save-rename-set-button">
								<span className="codicon codicon-check" />
							</Button>
						</StandardTooltip>
						<StandardTooltip content={t("settings:common.cancel")}>
							<Button
								variant="ghost"
								size="icon"
								onClick={handleCancel}
								data-testid="cancel-rename-set-button">
								<span className="codicon codicon-close" />
							</Button>
						</StandardTooltip>
					</div>
					{error && (
						<div className="text-vscode-descriptionForeground text-sm mt-1" data-testid="error-message">
							{error}
						</div>
					)}
				</div>
			) : (
				<>
					<div className="flex items-center gap-1">
						<SearchableSelect
							value={activeConfigurationSetId}
							onValueChange={handleSelectSet}
							options={configurationSets.map(
								(set) =>
									({
										value: set.id,
										label: set.name,
									}) as SearchableSelectOption,
							)}
							placeholder={t("settings:common.select")}
							searchPlaceholder={t("prompts:configurationSet.searchPlaceholder")}
							emptyMessage={t("prompts:configurationSet.noMatchFound")}
							className="grow"
							data-testid="configuration-set-select"
						/>
						<StandardTooltip content={t("prompts:configurationSet.addSet")}>
							<Button
								variant="ghost"
								size="icon"
								onClick={handleAdd}
								data-testid="add-configuration-set-button">
								<span className="codicon codicon-add" />
							</Button>
						</StandardTooltip>
						{activeConfigurationSetId && (
							<>
								<StandardTooltip content={t("prompts:configurationSet.renameSet")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={handleStartRename}
										data-testid="rename-configuration-set-button">
										<span className="codicon codicon-edit" />
									</Button>
								</StandardTooltip>
								<StandardTooltip
									content={
										isOnlySet
											? t("prompts:configurationSet.cannotDeleteOnlySet")
											: t("prompts:configurationSet.deleteSet")
									}>
									<Button
										variant="ghost"
										size="icon"
										onClick={handleDelete}
										data-testid="delete-configuration-set-button"
										disabled={isOnlySet}>
										<span className="codicon codicon-trash" />
									</Button>
								</StandardTooltip>
							</>
						)}
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("prompts:configurationSet.description")}
					</div>
				</>
			)}

			<Dialog
				open={isCreating}
				onOpenChange={(open: boolean) => {
					if (open) {
						setIsCreating(true)
						setNewSetName("")
						setSeedFromCurrent(true)
						setError(null)
					} else {
						resetCreateState()
					}
				}}
				aria-labelledby="new-configuration-set-title">
				<DialogContent className="p-4 max-w-sm bg-card">
					<DialogTitle>{t("prompts:configurationSet.newSet")}</DialogTitle>
					<Input
						ref={newSetInputRef}
						value={newSetName}
						onInput={(e: unknown) => {
							const target = e as { target: { value: string } }
							setNewSetName(target.target.value)
							setError(null)
						}}
						placeholder={t("prompts:configurationSet.enterSetName")}
						data-testid="new-configuration-set-input"
						style={{ width: "100%" }}
						onKeyDown={(e: unknown) => {
							const event = e as { key: string }
							if (event.key === "Enter" && newSetName.trim()) {
								handleNewSetSave()
							} else if (event.key === "Escape") {
								resetCreateState()
							}
						}}
					/>
					<div className="mt-3">
						<VSCodeCheckbox
							checked={seedFromCurrent}
							onChange={(e: unknown) => {
								const target = e as { target: { checked: boolean } }
								setSeedFromCurrent(target.target.checked)
							}}
							data-testid="seed-from-current-checkbox">
							{t("prompts:configurationSet.seedFromCurrent")}
						</VSCodeCheckbox>
					</div>
					{error && (
						<p className="text-vscode-errorForeground text-sm mt-2" data-testid="error-message">
							{error}
						</p>
					)}
					<div className="flex justify-end gap-2 mt-4">
						<Button
							variant="secondary"
							onClick={resetCreateState}
							data-testid="cancel-new-configuration-set-button">
							{t("settings:common.cancel")}
						</Button>
						<Button
							variant="primary"
							disabled={!newSetName.trim()}
							onClick={handleNewSetSave}
							data-testid="create-configuration-set-button">
							{t("prompts:configurationSet.createSet")}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	)
}

export default memo(ConfigurationSetManager)
