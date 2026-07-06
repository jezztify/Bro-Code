import { APIError } from "openai"

import { checkContextWindowExceededError, isRetriableViaFallbackError } from "../context-error-handling"

describe("checkContextWindowExceededError", () => {
	describe("OpenAI errors", () => {
		it("should detect OpenAI context window error with APIError instance", () => {
			const error = Object.create(APIError.prototype)
			Object.assign(error, {
				status: 400,
				code: "400",
				message: "This model's maximum context length is 4096 tokens",
				error: {
					message: "This model's maximum context length is 4096 tokens",
					type: "invalid_request_error",
					param: null,
					code: "context_length_exceeded",
				},
			})

			expect(checkContextWindowExceededError(error)).toBe(true)
		})

		it("should detect OpenAI LengthFinishReasonError", () => {
			const error = {
				name: "LengthFinishReasonError",
				message: "The response was cut off due to length",
			}

			expect(checkContextWindowExceededError(error)).toBe(true)
		})

		it("should not detect non-context OpenAI errors", () => {
			const error = Object.create(APIError.prototype)
			Object.assign(error, {
				status: 400,
				code: "400",
				message: "Invalid API key",
				error: {
					message: "Invalid API key",
					type: "invalid_request_error",
					param: null,
					code: "invalid_api_key",
				},
			})

			expect(checkContextWindowExceededError(error)).toBe(false)
		})
	})

	describe("OpenRouter errors", () => {
		it("should detect OpenRouter context window error with status 400", () => {
			const error = {
				status: 400,
				message: "Request exceeds maximum context length of 8192 tokens",
			}

			expect(checkContextWindowExceededError(error)).toBe(true)
		})

		it("should detect OpenRouter error with nested error structure", () => {
			const error = {
				error: {
					status: 400,
					message: "Input tokens exceed model limit",
				},
			}

			expect(checkContextWindowExceededError(error)).toBe(true)
		})

		it("should detect OpenRouter error with response status", () => {
			const error = {
				response: {
					status: 400,
				},
				message: "Too many tokens in the request",
			}

			expect(checkContextWindowExceededError(error)).toBe(true)
		})

		it("should detect various context error patterns", () => {
			const patterns = [
				"context length exceeded",
				"maximum context window",
				"input tokens exceed limit",
				"too many tokens",
			]

			patterns.forEach((pattern) => {
				const error = {
					status: 400,
					message: pattern,
				}
				expect(checkContextWindowExceededError(error)).toBe(true)
			})
		})

		it("should not detect non-context 400 errors", () => {
			const error = {
				status: 400,
				message: "Invalid request format",
			}

			expect(checkContextWindowExceededError(error)).toBe(false)
		})

		it("should not detect errors with different status codes", () => {
			const error = {
				status: 500,
				message: "context length exceeded",
			}

			expect(checkContextWindowExceededError(error)).toBe(false)
		})
	})

	describe("Anthropic errors", () => {
		it("should detect Anthropic context window error", () => {
			const error = {
				error: {
					error: {
						type: "invalid_request_error",
						message: "prompt is too long: 150000 tokens > 100000 maximum",
					},
				},
			}

			expect(checkContextWindowExceededError(error)).toBe(true)
		})

		it("should detect Anthropic error with context_length_exceeded code", () => {
			const error = {
				error: {
					error: {
						type: "invalid_request_error",
						code: "context_length_exceeded",
						message: "The request exceeds the maximum context window",
					},
				},
			}

			expect(checkContextWindowExceededError(error)).toBe(true)
		})

		it("should detect various Anthropic context error patterns", () => {
			const patterns = [
				"prompt is too long",
				"maximum 200000 tokens",
				"context is too long",
				"exceeds the context window",
				"token limit exceeded",
			]

			patterns.forEach((pattern) => {
				const error = {
					error: {
						error: {
							type: "invalid_request_error",
							message: pattern,
						},
					},
				}
				expect(checkContextWindowExceededError(error)).toBe(true)
			})
		})

		it("should not detect non-context Anthropic errors", () => {
			const error = {
				error: {
					error: {
						type: "invalid_request_error",
						message: "Invalid model specified",
					},
				},
			}

			expect(checkContextWindowExceededError(error)).toBe(false)
		})

		it("should not detect errors with different error types", () => {
			const error = {
				error: {
					error: {
						type: "authentication_error",
						message: "prompt is too long",
					},
				},
			}

			expect(checkContextWindowExceededError(error)).toBe(false)
		})
	})

	describe("Edge cases", () => {
		it("should handle null input", () => {
			expect(checkContextWindowExceededError(null)).toBe(false)
		})

		it("should handle undefined input", () => {
			expect(checkContextWindowExceededError(undefined)).toBe(false)
		})

		it("should handle empty object", () => {
			expect(checkContextWindowExceededError({})).toBe(false)
		})

		it("should handle string input", () => {
			expect(checkContextWindowExceededError("error")).toBe(false)
		})

		it("should handle number input", () => {
			expect(checkContextWindowExceededError(123)).toBe(false)
		})

		it("should handle array input", () => {
			expect(checkContextWindowExceededError([])).toBe(false)
		})

		it("should handle errors with circular references", () => {
			const error: any = { status: 400, message: "context length exceeded" }
			error.self = error // Create circular reference

			expect(checkContextWindowExceededError(error)).toBe(true)
		})

		it("should handle errors with deeply nested undefined values", () => {
			const error = {
				error: {
					error: {
						type: undefined,
						message: undefined,
					},
				},
			}

			expect(checkContextWindowExceededError(error)).toBe(false)
		})

		it("should handle errors that throw during property access", () => {
			const error = {
				get status() {
					throw new Error("Property access error")
				},
				message: "context length exceeded",
			}

			expect(checkContextWindowExceededError(error)).toBe(false)
		})

		it("should handle mixed provider error structures", () => {
			// Error that could match multiple providers
			const error = {
				status: 400,
				code: "400",
				message: "context length exceeded",
				error: {
					error: {
						type: "invalid_request_error",
						message: "prompt is too long",
					},
				},
			}

			expect(checkContextWindowExceededError(error)).toBe(true)
		})
	})

	describe("Multiple provider detection", () => {
		it("should detect error if any provider check returns true", () => {
			// This error should be detected by OpenRouter check
			const error1 = {
				status: 400,
				message: "context window exceeded",
			}
			expect(checkContextWindowExceededError(error1)).toBe(true)

			// This error should be detected by Anthropic check
			const error2 = {
				error: {
					error: {
						type: "invalid_request_error",
						message: "prompt is too long",
					},
				},
			}
			expect(checkContextWindowExceededError(error2)).toBe(true)
		})
	})
})

describe("isRetriableViaFallbackError", () => {
	it("returns true for 429 rate-limit errors", () => {
		expect(isRetriableViaFallbackError({ status: 429, message: "Too Many Requests" })).toBe(true)
	})

	it("returns true for 408 request timeout", () => {
		expect(isRetriableViaFallbackError({ status: 408, message: "Request Timeout" })).toBe(true)
	})

	it.each([500, 502, 503, 504])("returns true for %s server errors", (status) => {
		expect(isRetriableViaFallbackError({ status, message: "server error" })).toBe(true)
	})

	it("reads status from nested fields (code / error.status / response.status)", () => {
		expect(isRetriableViaFallbackError({ code: "503" })).toBe(true)
		expect(isRetriableViaFallbackError({ error: { status: 502 } })).toBe(true)
		expect(isRetriableViaFallbackError({ response: { status: 429 } })).toBe(true)
	})

	it("returns false for auth and bad-request errors (fail loud)", () => {
		expect(isRetriableViaFallbackError({ status: 401, message: "Unauthorized" })).toBe(false)
		expect(isRetriableViaFallbackError({ status: 403, message: "Forbidden" })).toBe(false)
		expect(isRetriableViaFallbackError({ status: 400, message: "Bad Request" })).toBe(false)
		expect(isRetriableViaFallbackError({ status: 422, message: "Unprocessable Entity" })).toBe(false)
	})

	it("returns false for context-window errors (handled by truncation, not failover)", () => {
		const error = {
			error: { error: { type: "invalid_request_error", message: "prompt is too long" } },
		}
		// Sanity: this IS a context-window error...
		expect(checkContextWindowExceededError(error)).toBe(true)
		// ...so it must NOT be treated as failover-retriable.
		expect(isRetriableViaFallbackError(error)).toBe(false)
	})

	it("returns true for network-level errors with no HTTP status", () => {
		expect(isRetriableViaFallbackError({ code: "ECONNRESET", message: "socket hang up" })).toBe(true)
		expect(isRetriableViaFallbackError({ message: "fetch failed" })).toBe(true)
		expect(isRetriableViaFallbackError({ code: "UND_ERR_BODY_TIMEOUT", message: "body timeout" })).toBe(true)
	})

	it("walks the cause chain to find the underlying network error", () => {
		const error = {
			message: "completion error",
			cause: { message: "fetch failed", cause: { code: "ETIMEDOUT", message: "connect ETIMEDOUT" } },
		}
		expect(isRetriableViaFallbackError(error)).toBe(true)
	})

	it("does not infinite-loop on a circular cause chain", () => {
		const error: any = { message: "fetch failed" }
		error.cause = error // circular reference
		expect(isRetriableViaFallbackError(error)).toBe(true)

		const benign: any = { message: "nothing retriable here" }
		benign.cause = benign
		expect(isRetriableViaFallbackError(benign)).toBe(false)
	})

	it("returns false for unknown non-network errors with no status", () => {
		expect(isRetriableViaFallbackError({ message: "something weird happened" })).toBe(false)
		expect(isRetriableViaFallbackError(null)).toBe(false)
		expect(isRetriableViaFallbackError(undefined)).toBe(false)
		expect(isRetriableViaFallbackError("a string")).toBe(false)
	})
})
