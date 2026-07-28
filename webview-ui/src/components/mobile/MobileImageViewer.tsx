import { useAppTranslation } from "@/i18n/TranslationContext"

interface MobileImageViewerProps {
	/** Undefined renders nothing - callers just always mount this and set/clear `src`. */
	src: string | undefined
	onClose: () => void
}

/**
 * Full-screen `<img>` lightbox used in mobile mode in place of the desktop
 * `openImage` round-trip (which asks the extension host to open the image in
 * a VS Code editor tab - meaningless on a phone browser with no such host).
 * See `Thumbnails.tsx` and `ImageViewer.tsx`, gated via `useMobileMode()`.
 */
export function MobileImageViewer({ src, onClose }: MobileImageViewerProps) {
	const { t } = useAppTranslation()

	if (!src) {
		return null
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
			onClick={onClose}
			role="dialog"
			aria-modal="true">
			<button
				className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full border-none bg-black/40 text-white"
				aria-label={t("common:mermaid.buttons.close")}
				onClick={onClose}>
				<span className="codicon codicon-close text-lg" />
			</button>
			<img
				src={src}
				alt=""
				className="max-h-full max-w-full object-contain"
				onClick={(event) => event.stopPropagation()}
			/>
		</div>
	)
}
