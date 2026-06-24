import type { ExtensionMessage } from "@bro-code/types"

/** Notifies the webview that Bro Gateway credentials are available for model discovery. */
export function postBroGatewayCredentialsReady(postMessage: (message: ExtensionMessage) => void): void {
	postMessage({ type: "broGatewayCredentialsReady" })
}
