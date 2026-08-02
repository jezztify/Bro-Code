import type { ModelInfo } from "../model.js"

import { anthropicModels, type AnthropicModelId } from "./anthropic.js"

/**
 * Claude Code (Claude.ai OAuth) provider.
 *
 * Authentication is a browser OAuth/PKCE sign-in to a Claude.ai account rather
 * than an API key, so no credentials are stored in provider settings — tokens
 * live in VS Code SecretStorage (see `src/integrations/claude-code/oauth.ts`).
 *
 * Requests go to the standard Anthropic Messages API with a Bearer token, so
 * the catalog is the Anthropic catalog. Pricing is omitted from the UI because
 * subscription usage is not billed per token.
 */

/**
 * The full Anthropic catalog, deliberately not a curated subset: which models a
 * given Claude.ai plan may call is decided server-side per account, and a
 * hardcoded list here would silently hide new releases. An unentitled model
 * fails at request time with a clear API error instead.
 */
export type ClaudeCodeModelId = AnthropicModelId

export const claudeCodeModels = anthropicModels

export const claudeCodeDefaultModelId: ClaudeCodeModelId = "claude-sonnet-5"

export const claudeCodeDefaultModelInfo: ModelInfo = claudeCodeModels[claudeCodeDefaultModelId]
