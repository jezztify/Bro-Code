import axios from "axios"

import type { ModelInfo } from "@bro-code/types"

import type { ApiHandlerOptions } from "../../../shared/api"
import { getBroCodeBaseUrl, resolveBroGatewaySessionToken } from "../../../services/bro-code-auth"

import {
	type VercelAiGatewayModel,
	parseVercelAiGatewayModel,
	vercelAiGatewayModelsResponseSchema,
} from "./vercel-ai-gateway"

// Bound model discovery so a network stall can't hang provider initialization paths.
const MODEL_DISCOVERY_TIMEOUT_MS = 15_000

/**
 * getBroGatewayModels
 *
 * Fetches models from the Bro Gateway API. Requires authentication via the bro_ext_ token.
 */

export async function getBroGatewayModels(options?: ApiHandlerOptions): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}
	const baseURL = options?.broGatewayBaseUrl ?? `${getBroCodeBaseUrl()}/api/gateway/v1`

	const sessionToken = resolveBroGatewaySessionToken(options?.broSessionToken)
	if (!sessionToken) {
		return models
	}

	const headers: Record<string, string> = {
		Authorization: `Bearer ${sessionToken}`,
	}

	try {
		const response = await axios.get(`${baseURL}/models`, {
			headers,
			timeout: MODEL_DISCOVERY_TIMEOUT_MS,
		})
		const result = vercelAiGatewayModelsResponseSchema.safeParse(response.data)

		if (!result.success) {
			console.error(`Bro Gateway models response is invalid ${JSON.stringify(result.error.format())}`)
			return models
		}

		for (const model of result.data.data) {
			const { id } = model

			// Only include language models for chat inference.
			// Embedding models are statically defined in embeddingModels.ts.
			if (model.type !== "language") {
				continue
			}

			models[id] = parseBroGatewayModel({ id, model })
		}
	} catch (error) {
		// Log only safe fields; never serialize the full error object because it
		// includes request config/headers which carry the bearer session token.
		const err = error as {
			message?: string
			name?: string
			code?: string
			response?: { status?: number; statusText?: string }
		}
		console.error(
			`Error fetching Bro Gateway models: name=${err.name ?? "Error"} code=${err.code ?? "unknown"} status=${err.response?.status ?? "unknown"} ${err.response?.statusText ?? ""} message=${err.message ?? "unknown error"}`,
		)
	}

	return models
}

/**
 * parseBroGatewayModel
 *
 * Parses a Bro Gateway model into ModelInfo format.
 * Bro Gateway returns the same format as Vercel AI Gateway, so we can reuse the parsing logic.
 */

export const parseBroGatewayModel = ({ id, model }: { id: string; model: VercelAiGatewayModel }): ModelInfo => {
	return parseVercelAiGatewayModel({ id, model })
}
