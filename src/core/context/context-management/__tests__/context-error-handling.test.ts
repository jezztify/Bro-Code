import { APIError } from "openai"

import { checkContextWindowExceededError } from "../context-error-handling"

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

	describe("Generic (provider-agnostic) context window errors", () => {
		it("should detect a Gemini-style overflow message", () => {
			const error = {
				status: 400,
				message: "The input token count exceeds the maximum context length",
			}
			expect(checkContextWindowExceededError(error)).toBe(true)
		})

		it("should detect a Bedrock-style overflow message", () => {
			const error = {
				status: 400,
				message: "Input is too long for requested model.",
			}
			expect(checkContextWindowExceededError(error)).toBe(true)
		})

		it("should detect a 413 with context-length wording", () => {
			const error = {
				status: 413,
				message: "context length exceeded",
			}
			expect(checkContextWindowExceededError(error)).toBe(true)
		})

		it("should detect an error message nested under response.data.error.message", () => {
			const error = {
				response: { data: { error: { message: "Request too large for the model's context window" } } },
			}
			expect(checkContextWindowExceededError(error)).toBe(true)
		})

		it("should detect an error message nested under body.error.message", () => {
			const error = {
				status: 400,
				body: { error: { message: "prompt too long: max tokens exceeded" } },
			}
			expect(checkContextWindowExceededError(error)).toBe(true)
		})

		it("should not detect an unrelated 400 error (e.g. invalid API key)", () => {
			const error = { status: 400, message: "Invalid API key" }
			expect(checkContextWindowExceededError(error)).toBe(false)
		})

		it("should not detect an unrelated 400 error (e.g. missing required field)", () => {
			const error = { status: 400, message: "Missing required field: model" }
			expect(checkContextWindowExceededError(error)).toBe(false)
		})

		it("should not match on 5xx server errors even with context-length wording", () => {
			const error = { status: 500, message: "context length exceeded" }
			expect(checkContextWindowExceededError(error)).toBe(false)
		})

		it("should not match a 401 auth error mentioning 'token'", () => {
			const error = { status: 401, message: "Invalid token" }
			expect(checkContextWindowExceededError(error)).toBe(false)
		})

		it("should not match a 429 rate-limit error", () => {
			const error = { status: 429, message: "Too many requests, please slow down" }
			expect(checkContextWindowExceededError(error)).toBe(false)
		})
	})
})
