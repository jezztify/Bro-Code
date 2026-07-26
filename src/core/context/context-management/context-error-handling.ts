import { APIError } from "openai"

export function checkContextWindowExceededError(error: unknown): boolean {
	return (
		checkIsOpenAIContextWindowError(error) ||
		checkIsOpenRouterContextWindowError(error) ||
		checkIsAnthropicContextWindowError(error) ||
		checkIsGenericContextWindowError(error)
	)
}

/**
 * Provider-agnostic fallback for context-window-exceeded detection.
 *
 * Providers not special-cased above (Gemini, Bedrock, Vertex, Groq, DeepSeek, Ollama,
 * LM Studio, Mistral, xAI, etc.) report overflow with their own error shapes/wording.
 * Without this, they get no truncate-and-retry safety net at all. This is intentionally
 * conservative: gated to 4xx-or-unknown status (never matches 5xx server errors) and to
 * specific, low-false-positive phrasing, so it doesn't misclassify unrelated request
 * errors (e.g. bad API key, invalid parameter) as context overflow.
 */
function checkIsGenericContextWindowError(error: unknown): boolean {
	try {
		if (!error || typeof error !== "object") {
			return false
		}

		const err = error as Record<string, any>

		const status = err.status ?? err.code ?? err.error?.status ?? err.response?.status
		const statusNum = typeof status === "number" ? status : Number.parseInt(String(status ?? ""), 10)
		if (Number.isFinite(statusNum) && (statusNum < 400 || statusNum >= 500)) {
			return false
		}

		const candidateMessages = [
			err.message,
			err.error?.message,
			err.response?.data?.error?.message,
			err.body?.error?.message,
			typeof err.body === "string" ? err.body : undefined,
		].filter((msg): msg is string => typeof msg === "string" && msg.length > 0)

		const GENERIC_CONTEXT_ERROR_PATTERNS = [
			/\bcontext\s*(?:length|window|size)\b/i,
			/\bmax(?:imum)?\s*(?:input\s*)?tokens?\b/i,
			/\btoo\s*many\s*tokens?\b/i,
			/\btoken\s*limit\b/i,
			/\binput\s*(?:is\s*)?too\s*long\b/i,
			/\bprompt\s*(?:is\s*)?too\s*long\b/i,
			/\bexceeds?\s*(?:the\s*)?(?:model'?s?\s*)?(?:context|token)\b/i,
			/\brequest\s*(?:is\s*)?too\s*large\b/i,
		] as const

		return candidateMessages.some((msg) => GENERIC_CONTEXT_ERROR_PATTERNS.some((pattern) => pattern.test(msg)))
	} catch {
		return false
	}
}

function checkIsOpenRouterContextWindowError(error: unknown): boolean {
	try {
		if (!error || typeof error !== "object") {
			return false
		}

		// Use Record<string, any> for proper type narrowing
		const err = error as Record<string, any>
		const status = err.status ?? err.code ?? err.error?.status ?? err.response?.status
		const message: string = String(err.message || err.error?.message || "")

		// Known OpenAI/OpenRouter-style signal (code 400 and message includes "context length")
		const CONTEXT_ERROR_PATTERNS = [
			/\bcontext\s*(?:length|window)\b/i,
			/\bmaximum\s*context\b/i,
			/\b(?:input\s*)?tokens?\s*exceed/i,
			/\btoo\s*many\s*tokens?\b/i,
		] as const

		return String(status) === "400" && CONTEXT_ERROR_PATTERNS.some((pattern) => pattern.test(message))
	} catch {
		return false
	}
}

// Docs: https://platform.openai.com/docs/guides/error-codes/api-errors
function checkIsOpenAIContextWindowError(error: unknown): boolean {
	try {
		// Check for LengthFinishReasonError
		if (error && typeof error === "object" && "name" in error && error.name === "LengthFinishReasonError") {
			return true
		}

		const KNOWN_CONTEXT_ERROR_SUBSTRINGS = ["token", "context length"] as const

		return (
			Boolean(error) &&
			error instanceof APIError &&
			error.code?.toString() === "400" &&
			KNOWN_CONTEXT_ERROR_SUBSTRINGS.some((substring) => error.message.includes(substring))
		)
	} catch {
		return false
	}
}

function checkIsAnthropicContextWindowError(response: unknown): boolean {
	try {
		// Type guard to safely access properties
		if (!response || typeof response !== "object") {
			return false
		}

		// Use type assertions with proper checks
		const res = response as Record<string, any>

		// Check for Anthropic-specific error structure with more specific validation
		if (res.error?.error?.type === "invalid_request_error") {
			const message: string = String(res.error?.error?.message || "")

			// More specific patterns for context window errors
			const contextWindowPatterns = [
				/prompt is too long/i,
				/maximum.*tokens/i,
				/context.*too.*long/i,
				/exceeds.*context/i,
				/token.*limit/i,
				/context_length_exceeded/i,
				/max_tokens_to_sample/i,
			]

			// Additional check for Anthropic-specific error codes
			const errorCode = res.error?.error?.code
			if (errorCode === "context_length_exceeded" || errorCode === "invalid_request_error") {
				return contextWindowPatterns.some((pattern) => pattern.test(message))
			}

			return contextWindowPatterns.some((pattern) => pattern.test(message))
		}

		return false
	} catch {
		return false
	}
}
