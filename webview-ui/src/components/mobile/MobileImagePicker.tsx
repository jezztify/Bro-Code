import { forwardRef, useImperativeHandle, useRef } from "react"

export interface MobileImagePickerRef {
	open: () => void
}

interface MobileImagePickerProps {
	onImagesSelected: (dataUrls: string[]) => void
}

function readFileAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(reader.result as string)
		reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"))
		reader.readAsDataURL(file)
	})
}

/**
 * Mobile-mode replacement for the desktop `selectImages` round-trip
 * (`ChatView.tsx`'s `selectImages` callback -> `webviewMessageHandler.ts`'s
 * `"selectImages"` case -> VS Code's native open-file dialog - meaningless on
 * a phone browser). Renders a hidden native `<input type="file">` with
 * `capture="environment"` so mobile browsers offer "Camera" alongside the
 * photo library, and reads selected files client-side via `FileReader` into
 * the same base64 data-URL shape `selectImages` already produces, so
 * `ChatView`'s `selectedImages` state and every downstream consumer need no
 * changes at all.
 */
export const MobileImagePicker = forwardRef<MobileImagePickerRef, MobileImagePickerProps>(
	({ onImagesSelected }, ref) => {
		const inputRef = useRef<HTMLInputElement>(null)

		useImperativeHandle(ref, () => ({
			open: () => inputRef.current?.click(),
		}))

		const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
			const files = event.target.files
			// Reset so selecting the exact same file again still fires onChange.
			event.target.value = ""

			if (!files || files.length === 0) {
				return
			}

			const dataUrls = await Promise.all(Array.from(files).map(readFileAsDataUrl))
			onImagesSelected(dataUrls)
		}

		return (
			<input
				ref={inputRef}
				type="file"
				accept="image/*"
				multiple
				capture="environment"
				className="hidden"
				onChange={handleChange}
			/>
		)
	},
)

MobileImagePicker.displayName = "MobileImagePicker"
