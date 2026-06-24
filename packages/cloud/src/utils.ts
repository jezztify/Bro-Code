import type { ExtensionContext } from "vscode"

export function getUserAgent(context?: ExtensionContext): string {
	return `Bro-Code ${context?.extension?.packageJSON?.version || "unknown"}`
}
