import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

import {
	clearBroCodeToken,
	clearBroCodeUserInfo,
	disconnectBroCode,
	getCachedBroCodeToken,
	getCachedBroCodeUserInfo,
	getBroCodeBaseUrl,
	handleAuthCallback,
	initBroCodeAuth,
	resolveBroGatewaySessionToken,
	setBroCodeToken,
	setBroCodeUserInfo,
	verifyBroCodeToken,
} from "../bro-code-auth"

vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(() => ({
			get: vi.fn((key: string, defaultValue?: string) => defaultValue),
		})),
	},
	window: {
		showErrorMessage: vi.fn(),
		showInformationMessage: vi.fn(),
	},
}))

vi.mock("../i18n", () => ({
	t: vi.fn((key: string) => key),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch as any

describe("bro-code-auth", () => {
	let mockSecrets: any
	let mockContext: any

	beforeEach(() => {
		vi.clearAllMocks()
		mockFetch.mockReset()

		const secretStore: Record<string, string> = {}
		mockSecrets = {
			get: vi.fn(async (key: string) => secretStore[key]),
			store: vi.fn(async (key: string, value: string) => {
				secretStore[key] = value
			}),
			delete: vi.fn(async (key: string) => {
				delete secretStore[key]
			}),
			onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
		}

		mockContext = {
			secrets: mockSecrets,
		}
	})

	afterEach(async () => {
		await clearBroCodeToken()
		await clearBroCodeUserInfo()
		vi.restoreAllMocks()
	})

	describe("getCachedBroCodeToken", () => {
		it("returns an empty string when no token is set", async () => {
			await clearBroCodeToken()

			expect(getCachedBroCodeToken()).toBe("")
		})

		it("preloads the cached token during initialization", async () => {
			await mockSecrets.store("bro-code-session-token", "bro_ext_cached_token")
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ valid: true }),
			})

			await initBroCodeAuth(mockContext)
			await Promise.resolve()

			expect(getCachedBroCodeToken()).toBe("bro_ext_cached_token")
		})
	})

	describe("initBroCodeAuth", () => {
		it("clears stored user info and token when the cached token is invalid", async () => {
			await mockSecrets.store("bro-code-session-token", "bro_ext_stale_token")
			await mockSecrets.store("bro-code-user-name", "Jane Doe")
			await mockSecrets.store("bro-code-user-email", "jane@example.com")
			await mockSecrets.store("bro-code-user-image", "https://example.com/avatar.png")
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ valid: false }),
			})

			await initBroCodeAuth(mockContext)

			// Both token and user info should be cleared on a definitive invalid response
			expect(getCachedBroCodeToken()).toBe("")
			expect(getCachedBroCodeUserInfo()).toEqual({
				name: undefined,
				email: undefined,
				image: undefined,
			})
		})

		it("clears stored user info and token when backend returns HTTP error (invalid token)", async () => {
			await mockSecrets.store("bro-code-session-token", "bro_ext_stale_token")
			await mockSecrets.store("bro-code-user-name", "Jane Doe")
			await mockSecrets.store("bro-code-user-email", "jane@example.com")
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				statusText: "Unauthorized",
			})

			await initBroCodeAuth(mockContext)

			expect(getCachedBroCodeToken()).toBe("")
			expect(getCachedBroCodeUserInfo()).toEqual({
				name: undefined,
				email: undefined,
				image: undefined,
			})
		})

		it("preserves token and user info when the backend is temporarily unreachable", async () => {
			await mockSecrets.store("bro-code-session-token", "bro_ext_valid_token")
			await mockSecrets.store("bro-code-user-name", "Jane Doe")
			await mockSecrets.store("bro-code-user-email", "jane@example.com")
			// Simulate a network error during verification
			mockFetch.mockRejectedValueOnce(new Error("Network error"))

			await initBroCodeAuth(mockContext)

			expect(getCachedBroCodeToken()).toBe("bro_ext_valid_token")
			expect(getCachedBroCodeUserInfo().name).toBe("Jane Doe")
		})

		it("preserves token and user info when verify returns 5xx (transient backend error)", async () => {
			await mockSecrets.store("bro-code-session-token", "bro_ext_valid_token")
			await mockSecrets.store("bro-code-user-name", "Jane Doe")
			await mockSecrets.store("bro-code-user-email", "jane@example.com")
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 503,
				statusText: "Service Unavailable",
			})

			await initBroCodeAuth(mockContext)

			expect(getCachedBroCodeToken()).toBe("bro_ext_valid_token")
			expect(getCachedBroCodeUserInfo().name).toBe("Jane Doe")
		})
	})

	describe("clearBroCodeToken", () => {
		it("clears the cached token", async () => {
			await initBroCodeAuth(mockContext)
			await setBroCodeToken("bro_ext_test_token")

			await clearBroCodeToken()

			expect(getCachedBroCodeToken()).toBe("")
		})
	})

	describe("getBroCodeBaseUrl", () => {
		it("returns the default URL when BRO_CODE_BASE_URL is not set", () => {
			const originalEnv = process.env.BRO_CODE_BASE_URL
			delete process.env.BRO_CODE_BASE_URL

			expect(getBroCodeBaseUrl()).toBe("https://www.brocode.dev")

			if (originalEnv) {
				process.env.BRO_CODE_BASE_URL = originalEnv
			}
		})

		it("respects BRO_CODE_BASE_URL", () => {
			const originalEnv = process.env.BRO_CODE_BASE_URL
			process.env.BRO_CODE_BASE_URL = "https://staging.brocode.dev"

			expect(getBroCodeBaseUrl()).toBe("https://staging.brocode.dev")

			if (originalEnv) {
				process.env.BRO_CODE_BASE_URL = originalEnv
			} else {
				delete process.env.BRO_CODE_BASE_URL
			}
		})
	})

	describe("handleAuthCallback", () => {
		it("does not persist a token when backend verification fails", async () => {
			await initBroCodeAuth(mockContext)
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ valid: false }),
			})

			const success = await handleAuthCallback("bro_ext_fake_token")

			expect(success).toBe(false)
			expect(getCachedBroCodeToken()).toBe("")
			expect(mockSecrets.store).not.toHaveBeenCalledWith("bro-code-session-token", "bro_ext_fake_token")
		})

		it("persists a token only after backend verification succeeds", async () => {
			await initBroCodeAuth(mockContext)
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ valid: true }),
			})

			const success = await handleAuthCallback("bro_ext_real_token")

			expect(success).toBe(true)
			expect(getCachedBroCodeToken()).toBe("bro_ext_real_token")
			expect(mockSecrets.store).toHaveBeenCalledWith("bro-code-session-token", "bro_ext_real_token")
		})
	})

	describe("verifyBroCodeToken", () => {
		it("returns 'valid' when the backend confirms the token", async () => {
			await initBroCodeAuth(mockContext)
			await setBroCodeToken("bro_ext_valid_token")
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ valid: true }),
			})

			expect(await verifyBroCodeToken()).toBe("valid")
			// Token should NOT be cleared — no side effects
			expect(getCachedBroCodeToken()).toBe("bro_ext_valid_token")
		})

		it("returns 'invalid' when the backend reports valid: false", async () => {
			await initBroCodeAuth(mockContext)
			await setBroCodeToken("bro_ext_invalid_token")
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ valid: false }),
			})

			expect(await verifyBroCodeToken()).toBe("invalid")
			// No side effects — caller decides what to do
			expect(getCachedBroCodeToken()).toBe("bro_ext_invalid_token")
		})

		it("returns 'invalid' when the backend returns 4xx", async () => {
			await initBroCodeAuth(mockContext)
			await setBroCodeToken("bro_ext_invalid_token")
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				statusText: "Unauthorized",
			})

			expect(await verifyBroCodeToken()).toBe("invalid")
		})

		it("returns 'unreachable' when the backend returns 5xx (transient)", async () => {
			await initBroCodeAuth(mockContext)
			await setBroCodeToken("bro_ext_token")
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 503,
				statusText: "Service Unavailable",
			})

			expect(await verifyBroCodeToken()).toBe("unreachable")
			expect(getCachedBroCodeToken()).toBe("bro_ext_token")
		})

		it("returns 'unreachable' when a network error occurs", async () => {
			await initBroCodeAuth(mockContext)
			await setBroCodeToken("bro_ext_token")
			mockFetch.mockRejectedValueOnce(new Error("Network error"))

			expect(await verifyBroCodeToken()).toBe("unreachable")
			// Token must NOT be cleared on network error
			expect(getCachedBroCodeToken()).toBe("bro_ext_token")
		})

		it("returns 'invalid' when no token is stored", async () => {
			await initBroCodeAuth(mockContext)

			expect(await verifyBroCodeToken()).toBe("invalid")
		})
	})

	describe("setBroCodeUserInfo", () => {
		it("clears email when passed null", async () => {
			await initBroCodeAuth(mockContext)
			await setBroCodeUserInfo({
				name: "Jane Doe",
				email: "jane@example.com",
				image: "https://example.com/avatar.png",
			})

			// Verify email is set
			expect(getCachedBroCodeUserInfo().email).toBe("jane@example.com")

			// Clear email with null
			await setBroCodeUserInfo({ email: null })

			// Email should be cleared, but other fields should remain
			const info = getCachedBroCodeUserInfo()
			expect(info.email).toBeUndefined()
			expect(info.name).toBe("Jane Doe")
			expect(info.image).toBe("https://example.com/avatar.png")
		})

		it("does not clear email when passed undefined", async () => {
			await initBroCodeAuth(mockContext)
			await setBroCodeUserInfo({
				name: "Jane Doe",
				email: "jane@example.com",
				image: "https://example.com/avatar.png",
			})

			// Pass undefined for email - should preserve existing value
			await setBroCodeUserInfo({ name: "John Doe", email: undefined })

			const info = getCachedBroCodeUserInfo()
			expect(info.email).toBe("jane@example.com")
			expect(info.name).toBe("John Doe")
		})
	})

	describe("resolveBroGatewaySessionToken", () => {
		it("prefers the cached token over a profile token", async () => {
			await initBroCodeAuth(mockContext)
			await setBroCodeToken("bro_ext_cached")

			expect(resolveBroGatewaySessionToken("bro_ext_profile")).toBe("bro_ext_cached")
		})

		it("ignores profile tokens after an explicit sign-out clear", async () => {
			await initBroCodeAuth(mockContext)
			await setBroCodeToken("bro_ext_cached")
			await clearBroCodeToken()

			expect(resolveBroGatewaySessionToken("bro_ext_stale_profile")).toBeUndefined()
		})

		it("falls back to the profile token when the cache is empty and not cleared", async () => {
			await initBroCodeAuth(mockContext)

			expect(resolveBroGatewaySessionToken("bro_ext_profile")).toBe("bro_ext_profile")
		})
	})

	describe("disconnectBroCode", () => {
		it("revokes the current token and clears cached auth state", async () => {
			await initBroCodeAuth(mockContext)
			await setBroCodeToken("bro_ext_real_token")
			await setBroCodeUserInfo({
				name: "Jane Doe",
				email: "jane@example.com",
				image: "https://example.com/avatar.png",
			})
			mockFetch.mockResolvedValueOnce({ ok: true })

			await disconnectBroCode()

			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining("/api/extension/auth/revoke"),
				expect.objectContaining({
					method: "POST",
					headers: { Authorization: "Bearer bro_ext_real_token" },
				}),
			)
			expect(getCachedBroCodeToken()).toBe("")
			expect(getCachedBroCodeUserInfo()).toEqual({
				name: undefined,
				email: undefined,
				image: undefined,
			})
		})
	})
})
