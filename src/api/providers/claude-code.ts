import type { Anthropic as AnthropicSdk } from "@anthropic-ai/sdk"
import { Anthropic } from "@anthropic-ai/sdk"

import { claudeCodeDefaultModelId } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { CLAUDE_CODE_OAUTH_BETA, claudeCodeOAuthManager } from "../../integrations/claude-code/oauth"

import type { ApiHandlerCreateMessageMetadata, CompletePromptOptions } from "../index"
import type { ApiStream } from "../transform/stream"

import { AnthropicHandler } from "./anthropic"

/**
 * Claude.ai OAuth tokens are only accepted for inference when the request
 * identifies itself as Claude Code, so every system prompt is prefixed with
 * this line.
 */
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."

const NOT_SIGNED_IN =
	"Not signed in to Claude Code. Open provider settings and choose “Sign in with Claude” to connect your Claude.ai account."

function getHttpStatus(error: unknown): number | undefined {
	if (!error || typeof error !== "object") return undefined
	const candidate = error as { status?: unknown; cause?: { status?: unknown } }
	if (typeof candidate.status === "number") return candidate.status
	return typeof candidate.cause?.status === "number" ? candidate.cause.status : undefined
}

/**
 * Talks to the standard Anthropic Messages API, but authenticates with a
 * Claude.ai OAuth bearer token instead of an API key. Everything about request
 * shaping, prompt caching and stream decoding is inherited from
 * {@link AnthropicHandler}.
 */
export class ClaudeCodeHandler extends AnthropicHandler {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			apiModelId: options.apiModelId || claudeCodeDefaultModelId,
			// Reuse the parent's 1M-context handling, which reads the Anthropic flag.
			anthropicBeta1MContext: options.claudeCodeBeta1MContext,
		})

		this.providerName = "Claude Code"

		// Replace the API-key client with a bearer-token one. `apiKey: null`
		// suppresses the x-api-key header; the token is filled in per request
		// once the OAuth manager has a fresh one.
		this.client = new Anthropic({
			apiKey: null,
			authToken: "",
			defaultHeaders: { "anthropic-beta": CLAUDE_CODE_OAUTH_BETA },
			timeout: this.timeoutMs,
		})
	}

	/** Loads a valid token onto the client, refreshing when asked. */
	private async authenticate(forceRefresh = false): Promise<void> {
		const token = forceRefresh
			? await claudeCodeOAuthManager.forceRefreshAccessToken()
			: await claudeCodeOAuthManager.getAccessToken()

		if (!token) throw new Error(NOT_SIGNED_IN)

		this.client.authToken = token
	}

	override getModel(metadata?: ApiHandlerCreateMessageMetadata) {
		const model = super.getModel(metadata)

		// The parent only defaults `betas` when it is undefined, so carry its
		// default forward explicitly alongside the OAuth beta.
		const betas = [...(model.betas ?? ["fine-grained-tool-streaming-2025-05-14"]), CLAUDE_CODE_OAUTH_BETA]

		return { ...model, betas }
	}

	override async *createMessage(
		systemPrompt: string,
		messages: AnthropicSdk.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const system = systemPrompt.startsWith(CLAUDE_CODE_IDENTITY)
			? systemPrompt
			: `${CLAUDE_CODE_IDENTITY}\n\n${systemPrompt}`

		await this.authenticate()

		let yieldedAny = false

		try {
			for await (const chunk of super.createMessage(system, messages, metadata)) {
				yieldedAny = true
				yield chunk
			}
		} catch (error) {
			// Retry once on an auth failure, but only while the response is
			// still empty — replaying a partially consumed stream would
			// duplicate content the caller has already seen.
			if (yieldedAny || getHttpStatus(error) !== 401) throw error

			await this.authenticate(true)
			yield* super.createMessage(system, messages, metadata)
		}
	}

	override async completePrompt(prompt: string, options?: CompletePromptOptions): Promise<string> {
		await this.authenticate()

		try {
			return await super.completePrompt(prompt, options)
		} catch (error) {
			if (getHttpStatus(error) !== 401) throw error

			await this.authenticate(true)
			return super.completePrompt(prompt, options)
		}
	}
}
