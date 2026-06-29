import { useEffect, useState, useCallback } from "react"
import { useTranslation } from "react-i18next"

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, Button } from "@src/components/ui"
import { vscode } from "@src/utils/vscode"

interface StateArtifact {
	key: string
	format: "json" | "markdown"
	content: string
	mtime: number
}

interface StateInspectorModalProps {
	open: boolean
	onOpenChange: (open: boolean) => void
}

export const StateInspectorModal = ({ open, onOpenChange }: StateInspectorModalProps) => {
	const { t } = useTranslation()
	const [artifacts, setArtifacts] = useState<StateArtifact[]>([])
	const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | undefined>(undefined)
	const [requestId, setRequestId] = useState<string>("")

	const fetchState = useCallback(() => {
		const id = `task-state-${Date.now()}`
		setRequestId(id)
		setLoading(true)
		setError(undefined)
		vscode.postMessage({ type: "getTaskState", requestId: id })
	}, [])

	useEffect(() => {
		if (open) {
			fetchState()
		}
	}, [open, fetchState])

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "taskStateData" && message.requestId === requestId) {
				setLoading(false)
				setError(message.error)
				const nextArtifacts: StateArtifact[] = message.taskStateArtifacts || []
				setArtifacts(nextArtifacts)
				setSelectedKey((current) =>
					current && nextArtifacts.some((a) => a.key === current) ? current : nextArtifacts[0]?.key,
				)
			}
		}

		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [requestId])

	const selectedArtifact = artifacts.find((a) => a.key === selectedKey)

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent onClick={(e) => e.stopPropagation()} className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>{t("chat:stateInspectorModal.title")}</DialogTitle>
					<DialogDescription>{t("chat:stateInspectorModal.description")}</DialogDescription>
				</DialogHeader>
				{loading && (
					<div className="text-sm text-muted-foreground">{t("chat:stateInspectorModal.loading")}</div>
				)}
				{!loading && error && <div className="text-sm text-vscode-errorForeground">{error}</div>}
				{!loading && !error && artifacts.length === 0 && (
					<div className="text-sm text-muted-foreground">{t("chat:stateInspectorModal.empty")}</div>
				)}
				{!loading && !error && artifacts.length > 0 && (
					<div className="flex gap-3 min-h-0">
						<div className="flex flex-col gap-1 w-40 shrink-0 overflow-y-auto max-h-80">
							{artifacts.map((artifact) => (
								<Button
									key={artifact.key}
									variant={artifact.key === selectedKey ? "secondary" : "ghost"}
									size="sm"
									className="justify-start"
									onClick={() => setSelectedKey(artifact.key)}>
									{artifact.key}
								</Button>
							))}
						</div>
						<pre className="flex-1 overflow-auto max-h-80 text-xs bg-vscode-editor-background p-2 rounded whitespace-pre-wrap break-words">
							{selectedArtifact?.content}
						</pre>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}
