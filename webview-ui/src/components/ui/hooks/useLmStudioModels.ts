import { useQuery } from "@tanstack/react-query"

import { type ModelRecord, type ExtensionMessage } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

export const requestLmStudioModels = (baseUrl?: string, useRestApi?: boolean) =>
	vscode.postMessage({
		type: "requestLmStudioModels",
		values: typeof baseUrl === "string" ? { baseUrl, useRestApi } : undefined,
	})

const getLmStudioModels = async (baseUrl?: string, useRestApi?: boolean) =>
	new Promise<ModelRecord>((resolve, reject) => {
		const cleanup = () => {
			window.removeEventListener("message", handler)
		}

		const timeout = setTimeout(() => {
			cleanup()
			reject(new Error("LM Studio models request timed out"))
		}, 10000)

		const handler = (event: MessageEvent) => {
			const message: ExtensionMessage = event.data

			if (message.type === "lmStudioModels") {
				clearTimeout(timeout)
				cleanup()

				if (message.lmStudioModels) {
					resolve(message.lmStudioModels)
				} else {
					reject(new Error("No LMStudio models in response"))
				}
			}
		}

		window.addEventListener("message", handler)
		requestLmStudioModels(baseUrl, useRestApi)
	})

export const useLmStudioModels = (modelId?: string) =>
	useQuery({
		queryKey: ["lmStudioModels"],
		queryFn: () => (modelId ? getLmStudioModels() : {}),
	})

export interface LmStudioConnectionTestResult {
	success: boolean
	error?: string
	modelCount?: number
}

export const testLmStudioConnection = (
	baseUrl?: string,
	lmStudioBypassProxy?: boolean,
	lmStudioProxyUrl?: string,
): Promise<LmStudioConnectionTestResult> =>
	new Promise((resolve) => {
		const cleanup = () => {
			window.removeEventListener("message", handler)
		}

		const timeout = setTimeout(() => {
			cleanup()
			resolve({ success: false, error: "Connection test timed out" })
		}, 10000)

		const handler = (event: MessageEvent) => {
			const message: ExtensionMessage = event.data

			if (message.type === "lmStudioConnectionTestResult") {
				clearTimeout(timeout)
				cleanup()
				resolve({
					success: message.success === true,
					error: message.error,
					modelCount: message.values?.modelCount,
				})
			}
		}

		window.addEventListener("message", handler)
		vscode.postMessage({
			type: "testLmStudioConnection",
			values: { baseUrl, lmStudioBypassProxy, lmStudioProxyUrl },
		})
	})
