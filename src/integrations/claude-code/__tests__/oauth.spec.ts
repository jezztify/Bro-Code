import {
	CLAUDE_CODE_OAUTH_CONFIG,
	ClaudeCodeOAuthManager,
	buildAuthorizationUrl,
	generateCodeChallenge,
	generateCodeVerifier,
	isTokenExpired,
	type ClaudeCodeCredentials,
} from "../oauth"

const CREDENTIALS_KEY = "claude-code-oauth-credentials"

const createContext = () => {
	const values = new Map<string, string>()
	return {
		values,
		context: {
			secrets: {
				get: vi.fn(async (key: string) => values.get(key)),
				store: vi.fn(async (key: string, value: string) => void values.set(key, value)),
				delete: vi.fn(async (key: string) => void values.delete(key)),
			},
		} as any,
	}
}

const storedCredentials = (overrides: Partial<ClaudeCodeCredentials> = {}): ClaudeCodeCredentials => ({
	type: "claude-code",
	accessToken: "access-token",
	refreshToken: "refresh-token",
	expiresAt: Date.now() + 60 * 60 * 1000,
	email: "user@example.com",
	...overrides,
})

const tokenResponse = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status })

describe("Claude Code OAuth", () => {
	beforeEach(() => vi.restoreAllMocks())

	describe("PKCE", () => {
		it("derives an S256 challenge that differs from the verifier", () => {
			const verifier = generateCodeVerifier()
			const challenge = generateCodeChallenge(verifier)

			// base64url: no padding or +/ characters, and 43-128 chars per RFC 7636.
			expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
			expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
			expect(challenge).not.toBe(verifier)
			expect(generateCodeChallenge(verifier)).toBe(challenge)
		})

		it("builds an authorization URL with the public client and S256 method", () => {
			const url = new URL(buildAuthorizationUrl("challenge", "state-value"))

			expect(url.origin + url.pathname).toBe(CLAUDE_CODE_OAUTH_CONFIG.authorizationEndpoint)
			expect(url.searchParams.get("client_id")).toBe(CLAUDE_CODE_OAUTH_CONFIG.clientId)
			expect(url.searchParams.get("redirect_uri")).toBe(CLAUDE_CODE_OAUTH_CONFIG.redirectUri)
			expect(url.searchParams.get("response_type")).toBe("code")
			expect(url.searchParams.get("code_challenge")).toBe("challenge")
			expect(url.searchParams.get("code_challenge_method")).toBe("S256")
			expect(url.searchParams.get("state")).toBe("state-value")
		})
	})

	describe("isTokenExpired", () => {
		it("treats tokens inside the refresh buffer as expired", () => {
			expect(isTokenExpired(storedCredentials({ expiresAt: Date.now() + 60_000 }))).toBe(true)
			expect(isTokenExpired(storedCredentials({ expiresAt: Date.now() + 30 * 60 * 1000 }))).toBe(false)
		})
	})

	describe("ClaudeCodeOAuthManager", () => {
		it("returns the stored token without a network call while it is fresh", async () => {
			const { context, values } = createContext()
			values.set(CREDENTIALS_KEY, JSON.stringify(storedCredentials()))
			const fetchSpy = vi.spyOn(globalThis, "fetch")

			const manager = new ClaudeCodeOAuthManager()
			manager.initialize(context)

			expect(await manager.getAccessToken()).toBe("access-token")
			expect(fetchSpy).not.toHaveBeenCalled()
		})

		it("refreshes an expired token and persists the rotated refresh token", async () => {
			const { context, values } = createContext()
			values.set(CREDENTIALS_KEY, JSON.stringify(storedCredentials({ expiresAt: Date.now() - 1000 })))
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				tokenResponse({
					access_token: "new-access-token",
					refresh_token: "rotated-refresh-token",
					expires_in: 3600,
				}),
			)

			const manager = new ClaudeCodeOAuthManager()
			manager.initialize(context)

			expect(await manager.getAccessToken()).toBe("new-access-token")

			const [, init] = vi.mocked(fetch).mock.calls[0]
			expect(JSON.parse(String(init?.body))).toMatchObject({
				grant_type: "refresh_token",
				client_id: CLAUDE_CODE_OAUTH_CONFIG.clientId,
				refresh_token: "refresh-token",
			})

			const persisted = JSON.parse(values.get(CREDENTIALS_KEY)!)
			expect(persisted.accessToken).toBe("new-access-token")
			expect(persisted.refreshToken).toBe("rotated-refresh-token")
			// Profile metadata survives a refresh that omits it.
			expect(persisted.email).toBe("user@example.com")
		})

		it("clears credentials when the refresh grant is rejected", async () => {
			const { context, values } = createContext()
			values.set(CREDENTIALS_KEY, JSON.stringify(storedCredentials({ expiresAt: Date.now() - 1000 })))
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(tokenResponse({ error: "invalid_grant" }, 400))

			const manager = new ClaudeCodeOAuthManager()
			manager.initialize(context)

			expect(await manager.getAccessToken()).toBeNull()
			expect(values.has(CREDENTIALS_KEY)).toBe(false)
			expect(manager.getState().status).toBe("error")
		})

		it("keeps credentials when a refresh fails for a transient reason", async () => {
			const { context, values } = createContext()
			values.set(CREDENTIALS_KEY, JSON.stringify(storedCredentials({ expiresAt: Date.now() - 1000 })))
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(tokenResponse({ error: "server_error" }, 500))

			const manager = new ClaudeCodeOAuthManager()
			manager.initialize(context)

			expect(await manager.getAccessToken()).toBeNull()
			// A 5xx must not force the user to sign in again.
			expect(values.has(CREDENTIALS_KEY)).toBe(true)
		})

		it("reports signed-out state and drops unreadable credentials", async () => {
			const { context, values } = createContext()
			values.set(CREDENTIALS_KEY, "not-json")

			const manager = new ClaudeCodeOAuthManager()
			manager.initialize(context)

			expect(await manager.isAuthenticated()).toBe(false)
			expect(values.has(CREDENTIALS_KEY)).toBe(false)
		})

		it("signs out by deleting the stored credentials", async () => {
			const { context, values } = createContext()
			values.set(CREDENTIALS_KEY, JSON.stringify(storedCredentials()))

			const manager = new ClaudeCodeOAuthManager()
			manager.initialize(context)
			expect(await manager.isAuthenticated()).toBe(true)

			await manager.clearCredentials()

			expect(values.has(CREDENTIALS_KEY)).toBe(false)
			expect(manager.getState().status).toBe("idle")
			expect(await manager.getAccessToken()).toBeNull()
		})
	})
})
