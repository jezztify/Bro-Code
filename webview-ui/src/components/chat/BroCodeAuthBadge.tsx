import { useEffect, useRef, useState, type CSSProperties } from "react"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { getBroCodeAuthUrl } from "@src/oauth/urls"
import { vscode } from "@src/utils/vscode"
import { cn } from "@src/lib/utils"

interface BroCodeAuthBadgeProps {
	className?: string
}

// Generate a deterministic color from email/name
function getAvatarColor(str: string): string {
	const colors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#8b5cf6", "#ec4899", "#6366f1"]
	let hash = 0
	for (let i = 0; i < str.length; i++) {
		hash = str.charCodeAt(i) + ((hash << 5) - hash)
	}
	return colors[Math.abs(hash) % colors.length]
}

// Get proper initials from name or email
function getInitials(name?: string, email?: string): string {
	if (name) {
		const parts = name.trim().split(" ")
		if (parts.length >= 2) {
			return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
		}
		return name.slice(0, 2).toUpperCase()
	}
	if (email) {
		return email.slice(0, 2).toUpperCase()
	}
	return "?"
}

export const BroCodeAuthBadge: React.FC<BroCodeAuthBadgeProps> = ({ className }) => {
	const {
		broCodeIsAuthenticated,
		broCodeUserName,
		broCodeUserEmail,
		broCodeUserImage,
		broCodeBaseUrl,
		uriScheme,
		deviceName,
	} = useExtensionState()
	const [isOpen, setIsOpen] = useState(false)
	const [imageError, setImageError] = useState(false)
	const ref = useRef<HTMLDivElement>(null)

	// Close on outside click
	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setIsOpen(false)
			}
		}
		document.addEventListener("mousedown", handler)
		return () => document.removeEventListener("mousedown", handler)
	}, [])

	// Reset image error when image URL changes
	useEffect(() => {
		setImageError(false)
	}, [broCodeUserImage])

	const authUrl = getBroCodeAuthUrl(uriScheme, broCodeBaseUrl, deviceName)

	const showImage = broCodeIsAuthenticated && broCodeUserImage && !imageError
	const avatarColor = getAvatarColor(broCodeUserEmail || broCodeUserName || "ZC")
	const avatarButtonStyle: CSSProperties | undefined =
		broCodeIsAuthenticated && !showImage ? { backgroundColor: avatarColor } : undefined
	const menuItemClasses =
		"block cursor-pointer px-3.5 py-2.5 text-[13px] no-underline text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)]"

	const handleSignOut = () => {
		vscode.postMessage({ type: "broCodeSignOut" })
		setIsOpen(false)
	}

	return (
		<div ref={ref} className={cn("relative ml-2", className)}>
			{/* The icon button */}
			<button
				onClick={() => setIsOpen(!isOpen)}
				className={cn(
					"flex size-5 items-center justify-center overflow-hidden rounded-full p-0 transition-all duration-150",
					"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
					!broCodeIsAuthenticated &&
						"border border-vscode-descriptionForeground/50 bg-transparent text-vscode-descriptionForeground hover:border-vscode-descriptionForeground",
					broCodeIsAuthenticated &&
						!showImage &&
						"text-[9px] font-semibold text-[var(--vscode-button-foreground,#ffffff)]",
				)}
				style={avatarButtonStyle}
				title={broCodeIsAuthenticated ? `Bro Code: ${broCodeUserEmail || "Connected"}` : "Sign in to Bro Code"}>
				{broCodeIsAuthenticated ? (
					showImage ? (
						<img
							src={broCodeUserImage}
							alt="avatar"
							className="size-full rounded-full object-cover"
							onError={() => setImageError(true)}
						/>
					) : (
						<span>{getInitials(broCodeUserName, broCodeUserEmail)}</span>
					)
				) : (
					// Person icon SVG
					<svg
						width="10"
						height="10"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.5"
						strokeLinecap="round"
						strokeLinejoin="round">
						<circle cx="12" cy="8" r="4" />
						<path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
					</svg>
				)}
			</button>

			{/* Popover */}
			{isOpen && (
				<div
					className={cn(
						"absolute bottom-[calc(100%+8px)] right-0 z-[9999] min-w-[180px] overflow-hidden rounded-md shadow-lg",
						"border border-[var(--vscode-menu-border,var(--vscode-widget-border,#3c3c3c))]",
						"bg-[var(--vscode-menu-background)]",
					)}>
					{!broCodeIsAuthenticated ? (
						<a href={authUrl} onClick={() => setIsOpen(false)} className={menuItemClasses}>
							Sign in to Bro Code
						</a>
					) : (
						<>
							{broCodeUserEmail && (
								<div
									className={cn(
										"pointer-events-none select-none px-3.5 pb-1.5 pt-2 text-[11px] text-vscode-descriptionForeground",
										"border-b border-[var(--vscode-menu-separatorBackground,var(--vscode-widget-border,#3c3c3c))]",
									)}>
									{broCodeUserEmail}
								</div>
							)}
							<a
								href={`${broCodeBaseUrl || "https://www.brocode.dev"}/dashboard`}
								onClick={() => setIsOpen(false)}
								className={menuItemClasses}>
								Go to Dashboard
							</a>
							<button
								onClick={handleSignOut}
								className={cn(
									menuItemClasses,
									"w-full border-none bg-transparent text-left text-vscode-errorForeground",
								)}>
								Sign out
							</button>
						</>
					)}
				</div>
			)}
		</div>
	)
}
