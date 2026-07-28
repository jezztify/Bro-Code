import React, { useState, useRef, useLayoutEffect, memo } from "react"
import { useWindowSize } from "react-use"
import { vscode } from "@src/utils/vscode"
import { useMobileMode } from "@src/utils/useMobileMode"
import { MobileImageViewer } from "@src/components/mobile/MobileImageViewer"

interface ThumbnailsProps {
	images: string[]
	style?: React.CSSProperties
	setImages?: React.Dispatch<React.SetStateAction<string[]>>
	onHeightChange?: (height: number) => void
}

const Thumbnails = ({ images, style, setImages, onHeightChange }: ThumbnailsProps) => {
	const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
	const [lightboxSrc, setLightboxSrc] = useState<string | undefined>(undefined)
	const containerRef = useRef<HTMLDivElement>(null)
	const { width } = useWindowSize()
	const isMobile = useMobileMode()

	useLayoutEffect(() => {
		if (containerRef.current) {
			let height = containerRef.current.clientHeight
			// some browsers return 0 for clientHeight
			if (!height) {
				height = containerRef.current.getBoundingClientRect().height
			}
			onHeightChange?.(height)
		}
		setHoveredIndex(null)
	}, [images, width, onHeightChange])

	const handleDelete = (index: number) => {
		setImages?.((prevImages) => prevImages.filter((_, i) => i !== index))
	}

	const isDeletable = setImages !== undefined

	const handleImageClick = (image: string) => {
		// No extension host to round-trip "openImage" to in mobile mode; open the
		// in-page lightbox instead (see MobileImageViewer.tsx).
		if (isMobile) {
			setLightboxSrc(image)
		} else {
			vscode.postMessage({ type: "openImage", text: image })
		}
	}

	return (
		<div
			ref={containerRef}
			className="py-1"
			style={{
				display: "flex",
				flexWrap: "wrap",
				gap: 5,
				rowGap: 3,
				...style,
			}}>
			{images.map((image, index) => (
				<div
					key={index}
					style={{ position: "relative" }}
					onMouseEnter={() => setHoveredIndex(index)}
					onMouseLeave={() => setHoveredIndex(null)}>
					<img
						src={image}
						alt={`Thumbnail ${index + 1}`}
						style={{
							width: 34,
							height: 34,
							objectFit: "cover",
							borderRadius: 4,
							cursor: "pointer",
						}}
						onClick={() => handleImageClick(image)}
					/>
					{isDeletable && hoveredIndex === index && (
						<div
							onClick={() => handleDelete(index)}
							style={{
								position: "absolute",
								top: -4,
								right: -4,
								width: 13,
								height: 13,
								borderRadius: "50%",
								backgroundColor: "var(--vscode-badge-background)",
								display: "flex",
								justifyContent: "center",
								alignItems: "center",
								cursor: "pointer",
							}}>
							<span
								className="codicon codicon-close"
								style={{
									color: "var(--vscode-foreground)",
									fontSize: 10,
									fontWeight: "bold",
								}}></span>
						</div>
					)}
				</div>
			))}
			{isMobile && <MobileImageViewer src={lightboxSrc} onClose={() => setLightboxSrc(undefined)} />}
		</div>
	)
}

export default memo(Thumbnails)
