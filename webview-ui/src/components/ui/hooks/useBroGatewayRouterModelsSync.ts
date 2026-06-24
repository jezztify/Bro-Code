import { useCallback, useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"

import type { ExtensionMessage, RouterModels } from "@bro-code/types"

import { useExtensionState } from "@src/context/ExtensionStateContext"

import { fetchRouterModels } from "./useRouterModels"

/**
 * Keeps bro-gateway models in the shared routerModels query fresh when credentials
 * become available (sign-in or profile seeding) without coupling auth to modelCache.
 */
export function useBroGatewayRouterModelsSync() {
	const queryClient = useQueryClient()
	const { broCodeIsAuthenticated } = useExtensionState()
	const wasAuthenticatedRef = useRef<boolean | undefined>(undefined)

	const syncBroGatewayModels = useCallback(async () => {
		if (!broCodeIsAuthenticated) {
			return
		}

		try {
			const partial = await fetchRouterModels("bro-gateway")
			const broModels = partial["bro-gateway"]
			if (!broModels || Object.keys(broModels).length === 0) {
				return
			}

			queryClient.setQueryData<RouterModels>(["routerModels", "all"], (current) =>
				current ? { ...current, "bro-gateway": broModels } : partial,
			)
		} catch {
			// Ignore: bulk router fetch may still be in flight.
		}
	}, [queryClient, broCodeIsAuthenticated])

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const message = event.data as ExtensionMessage
			if (message.type === "broGatewayCredentialsReady") {
				void syncBroGatewayModels()
			}
		}

		window.addEventListener("message", onMessage)
		return () => window.removeEventListener("message", onMessage)
	}, [syncBroGatewayModels])

	useEffect(() => {
		const wasAuthenticated = wasAuthenticatedRef.current
		wasAuthenticatedRef.current = broCodeIsAuthenticated

		if (broCodeIsAuthenticated && wasAuthenticated === false) {
			void syncBroGatewayModels()
		}
	}, [broCodeIsAuthenticated, syncBroGatewayModels])
}
