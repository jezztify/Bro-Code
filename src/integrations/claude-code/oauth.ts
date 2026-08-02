import * as crypto from "crypto"
import * as http from "http"
import { URL } from "url"
import type { ExtensionContext } from "vscode"
import { z } from "zod"

/**
 * Claude Code OAuth (Claude.ai single sign-on).
 *
 * Authorization-code flow with PKCE against Claude.ai, exchanging at the
 * Anthropic console token endpoint. These are Claude Code's public client
 * values — there is no client secret, which is what makes the loopback + PKCE
 * flow safe for a desktop client.
 *
 * Tokens are held in VS Code SecretStorage only; they are never written into
 * provider profile JSON and therefore never leave the machine via settings
 * sync or profile export.
 */
export const CLAUDE_CODE_OAUTH_CONFIG = {
	authorizationEndpoint: "https://claude.ai/oauth/authorize",
	tokenEndpoint: "https://console.anthropic.com/v1/oauth/token",
	clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
	redirectUri: "http://localhost:54545/callback",
	scopes: "org:create_api_key user:profile user:inference",
	callbackPort: 54545,
	callbackPath: "/callback",
} as const

/** Beta header required for inference with a Claude.ai OAuth token. */
export const CLAUDE_CODE_OAUTH_BETA = "oauth-2025-04-20"

const CLAUDE_CODE_CREDENTIALS_KEY = "claude-code-oauth-credentials"
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000
const OAUTH_REQUEST_TIMEOUT_MS = 30_000
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000

const credentialsSchema = z.object({
	type: z.literal("claude-code"),
	accessToken: z.string().min(1),
	refreshToken: z.string().min(1),
	/** Milliseconds since epoch. */
	expiresAt: z.number(),
	scopes: z.string().optional(),
	email: z.string().optional(),
	organizationName: z.string().optional(),
})

export type ClaudeCodeCredentials = z.infer<typeof credentialsSchema>

const tokenResponseSchema = z.object({
	access_token: z.string().min(1),
	refresh_token: z.string().min(1).optional(),
	expires_in: z.number().positive(),
	scope: z.string().optional(),
	account: z.object({ email_address: z.string().optional() }).partial().optional(),
	organization: z.object({ name: z.string().optional() }).partial().optional(),
})

export type ClaudeCodeOAuthState = {
	status: "idle" | "authorizing" | "authenticated" | "error"
	email?: string
	organizationName?: string
	error?: string
}

class ClaudeCodeOAuthError extends Error {
	constructor(
		message: string,
		readonly status?: number,
		readonly code?: string,
	) {
		super(message)
		this.name = "ClaudeCodeOAuthError"
	}

	/** True when the refresh token is dead and re-authentication is the only fix. */
	isInvalidGrant(): boolean {
		if (this.code && /invalid_grant|invalid_request/i.test(this.code)) return true
		if (this.status === 400 || this.status === 401 || this.status === 403) {
			return /invalid_grant|revoked|expired/i.test(this.message)
		}
		return false
	}
}

export function generateCodeVerifier(): string {
	return crypto.randomBytes(32).toString("base64url")
}

export function generateCodeChallenge(verifier: string): string {
	return crypto.createHash("sha256").update(verifier).digest("base64url")
}

export function generateState(): string {
	return crypto.randomBytes(32).toString("base64url")
}

export function buildAuthorizationUrl(codeChallenge: string, state: string): string {
	const params = new URLSearchParams({
		client_id: CLAUDE_CODE_OAUTH_CONFIG.clientId,
		response_type: "code",
		redirect_uri: CLAUDE_CODE_OAUTH_CONFIG.redirectUri,
		scope: CLAUDE_CODE_OAUTH_CONFIG.scopes,
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
		state,
	})

	return `${CLAUDE_CODE_OAUTH_CONFIG.authorizationEndpoint}?${params.toString()}`
}

async function postJson(body: Record<string, string>): Promise<unknown> {
	const response = await fetch(CLAUDE_CODE_OAUTH_CONFIG.tokenEndpoint, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS),
	})

	if (!response.ok) {
		const text = await response.text()
		let code: string | undefined
		let description: string | undefined
		try {
			const parsed = JSON.parse(text) as { error?: unknown; error_description?: unknown }
			code = typeof parsed.error === "string" ? parsed.error : undefined
			description = typeof parsed.error_description === "string" ? parsed.error_description : undefined
		} catch {
			// Non-JSON error body; fall back to the raw text below.
		}
		throw new ClaudeCodeOAuthError(
			`Claude Code token request failed: ${response.status} ${response.statusText}${
				(description ?? text) ? ` - ${description ?? text}` : ""
			}`,
			response.status,
			code,
		)
	}

	return response.json()
}

function toCredentials(
	tokens: z.infer<typeof tokenResponseSchema>,
	previous?: ClaudeCodeCredentials,
): ClaudeCodeCredentials {
	const refreshToken = tokens.refresh_token ?? previous?.refreshToken
	if (!refreshToken) throw new Error("Claude Code OAuth did not return a refresh token")

	return {
		type: "claude-code",
		accessToken: tokens.access_token,
		refreshToken,
		expiresAt: Date.now() + tokens.expires_in * 1000,
		scopes: tokens.scope ?? previous?.scopes,
		email: tokens.account?.email_address ?? previous?.email,
		organizationName: tokens.organization?.name ?? previous?.organizationName,
	}
}

export async function exchangeCodeForTokens(
	code: string,
	codeVerifier: string,
	state: string,
): Promise<ClaudeCodeCredentials> {
	const tokens = tokenResponseSchema.parse(
		await postJson({
			grant_type: "authorization_code",
			client_id: CLAUDE_CODE_OAUTH_CONFIG.clientId,
			code,
			redirect_uri: CLAUDE_CODE_OAUTH_CONFIG.redirectUri,
			code_verifier: codeVerifier,
			state,
		}),
	)
	return toCredentials(tokens)
}

export async function refreshClaudeCodeTokens(credentials: ClaudeCodeCredentials): Promise<ClaudeCodeCredentials> {
	const tokens = tokenResponseSchema.parse(
		await postJson({
			grant_type: "refresh_token",
			client_id: CLAUDE_CODE_OAUTH_CONFIG.clientId,
			refresh_token: credentials.refreshToken,
		}),
	)
	return toCredentials(tokens, credentials)
}

export function isTokenExpired(credentials: ClaudeCodeCredentials): boolean {
	return Date.now() >= credentials.expiresAt - TOKEN_EXPIRY_BUFFER_MS
}

const CALLBACK_PAGE = (heading: string, detail: string) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${heading}</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display: flex; justify-content: center; align-items: center;
    height: 100vh; margin: 0; background: #1f1e1d; color: #f5f4f2;
  }
  .container { text-align: center; padding: 2rem; }
  h1 { font-size: 1.75rem; margin-bottom: 0.75rem; color: #d97757; }
  p { opacity: 0.85; }
</style>
</head>
<body>
<div class="container">
<h1>${heading}</h1>
<p>${detail}</p>
</div>
<script>setTimeout(() => window.close(), 3000);</script>
</body>
</html>`

export class ClaudeCodeOAuthManager {
	private context: ExtensionContext | null = null
	private credentials: ClaudeCodeCredentials | null = null
	private state: ClaudeCodeOAuthState = { status: "idle" }
	private refreshPromise: Promise<ClaudeCodeCredentials> | null = null
	private logFn: ((message: string) => void) | null = null
	private pendingAuth: { codeVerifier: string; state: string; server?: http.Server } | null = null

	initialize(context: ExtensionContext, logFn?: (message: string) => void): void {
		this.context = context
		this.logFn = logFn ?? null
	}

	private log(message: string): void {
		if (this.logFn) {
			this.logFn(message)
		} else {
			console.log(message)
		}
	}

	getState(): ClaudeCodeOAuthState {
		return { ...this.state }
	}

	async loadCredentials(): Promise<ClaudeCodeCredentials | null> {
		if (this.credentials) return this.credentials
		if (!this.context) return null

		const stored = await this.context.secrets.get(CLAUDE_CODE_CREDENTIALS_KEY)
		if (!stored) return null

		try {
			this.credentials = credentialsSchema.parse(JSON.parse(stored))
			this.state = {
				status: "authenticated",
				email: this.credentials.email,
				organizationName: this.credentials.organizationName,
			}
			return this.credentials
		} catch {
			// Stored blob is unreadable (shape change or corruption) — drop it.
			await this.context.secrets.delete(CLAUDE_CODE_CREDENTIALS_KEY)
			return null
		}
	}

	private async saveCredentials(credentials: ClaudeCodeCredentials): Promise<void> {
		if (!this.context) throw new Error("Claude Code OAuth manager is not initialized")
		await this.context.secrets.store(CLAUDE_CODE_CREDENTIALS_KEY, JSON.stringify(credentials))
		this.credentials = credentials
		this.state = {
			status: "authenticated",
			email: credentials.email,
			organizationName: credentials.organizationName,
		}
	}

	async clearCredentials(): Promise<void> {
		this.cancelAuthorizationFlow()
		await this.context?.secrets.delete(CLAUDE_CODE_CREDENTIALS_KEY)
		this.credentials = null
		this.refreshPromise = null
		this.state = { status: "idle" }
	}

	async isAuthenticated(): Promise<boolean> {
		return (await this.loadCredentials()) !== null
	}

	/**
	 * Returns a usable access token, refreshing when expired. `forceRefresh`
	 * covers the case where the server rejects a token we still consider valid.
	 */
	async getAccessToken(forceRefresh = false): Promise<string | null> {
		const credentials = await this.loadCredentials()
		if (!credentials) return null

		if (!forceRefresh && !isTokenExpired(credentials)) return credentials.accessToken

		if (!this.refreshPromise) {
			this.log("[claude-code-oauth] Refreshing access token...")
			this.refreshPromise = refreshClaudeCodeTokens(credentials).finally(() => {
				this.refreshPromise = null
			})
		}

		try {
			const refreshed = await this.refreshPromise
			await this.saveCredentials(refreshed)
			return refreshed.accessToken
		} catch (error) {
			this.log(`[claude-code-oauth] Token refresh failed: ${error instanceof Error ? error.message : error}`)
			// Only discard credentials when the grant itself is dead; a network
			// blip should not force the user to sign in again.
			if (error instanceof ClaudeCodeOAuthError && error.isInvalidGrant()) {
				await this.clearCredentials()
				this.state = { status: "error", error: "Claude Code session expired. Sign in again." }
			}
			return null
		}
	}

	async forceRefreshAccessToken(): Promise<string | null> {
		return this.getAccessToken(true)
	}

	/** Begins a flow and returns the URL the user must open. */
	startAuthorizationFlow(): string {
		this.cancelAuthorizationFlow()

		const codeVerifier = generateCodeVerifier()
		const state = generateState()
		this.pendingAuth = { codeVerifier, state }
		this.state = { status: "authorizing" }

		return buildAuthorizationUrl(generateCodeChallenge(codeVerifier), state)
	}

	/** Resolves once Claude.ai redirects back to the loopback listener. */
	async waitForCallback(): Promise<ClaudeCodeCredentials> {
		const pending = this.pendingAuth
		if (!pending) throw new Error("No pending Claude Code authorization flow")

		return new Promise<ClaudeCodeCredentials>((resolve, reject) => {
			const fail = (error: Error) => {
				this.state = { status: "error", error: error.message }
				this.pendingAuth = null
				reject(error)
			}

			const server = http.createServer(async (req, res) => {
				const url = new URL(req.url ?? "", `http://localhost:${CLAUDE_CODE_OAUTH_CONFIG.callbackPort}`)

				if (url.pathname !== CLAUDE_CODE_OAUTH_CONFIG.callbackPath) {
					res.writeHead(404)
					res.end("Not Found")
					return
				}

				const respond = (status: number, heading: string, detail: string) => {
					res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" })
					res.end(CALLBACK_PAGE(heading, detail))
				}

				const error = url.searchParams.get("error")
				if (error) {
					const description = url.searchParams.get("error_description") ?? error
					respond(400, "Sign-in failed", description)
					server.close()
					fail(new Error(`Claude Code authorization failed: ${description}`))
					return
				}

				const code = url.searchParams.get("code")
				const returnedState = url.searchParams.get("state")

				if (!code || !returnedState) {
					respond(400, "Sign-in failed", "The callback was missing its code or state parameter.")
					server.close()
					fail(new Error("Claude Code callback was missing code or state"))
					return
				}

				// Constant-time compare so a mismatched state cannot be probed.
				const expected = Buffer.from(pending.state)
				const actual = Buffer.from(returnedState)
				if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
					respond(400, "Sign-in failed", "State mismatch — the request may have been tampered with.")
					server.close()
					fail(new Error("Claude Code state mismatch"))
					return
				}

				try {
					const credentials = await exchangeCodeForTokens(code, pending.codeVerifier, returnedState)
					await this.saveCredentials(credentials)
					respond(200, "Signed in to Claude Code", "You can close this window and return to VS Code.")
					this.pendingAuth = null
					server.close()
					resolve(credentials)
				} catch (exchangeError) {
					const message = exchangeError instanceof Error ? exchangeError.message : String(exchangeError)
					respond(500, "Sign-in failed", "Could not exchange the authorization code.")
					server.close()
					fail(new Error(message))
				}
			})

			server.on("error", (err: NodeJS.ErrnoException) => {
				fail(
					err.code === "EADDRINUSE"
						? new Error(
								`Port ${CLAUDE_CODE_OAUTH_CONFIG.callbackPort} is already in use. ` +
									`Close whatever is using it (another Claude Code sign-in, most likely) and try again.`,
							)
						: err,
				)
			})

			const timeout = setTimeout(() => {
				server.close()
				fail(new Error("Claude Code sign-in timed out"))
			}, CALLBACK_TIMEOUT_MS)

			server.on("close", () => clearTimeout(timeout))

			server.listen(CLAUDE_CODE_OAUTH_CONFIG.callbackPort, "127.0.0.1", () => {
				if (this.pendingAuth === pending) this.pendingAuth.server = server
			})
		})
	}

	cancelAuthorizationFlow(): void {
		this.pendingAuth?.server?.close()
		this.pendingAuth = null
		if (this.state.status === "authorizing") this.state = { status: "idle" }
	}

	getCredentials(): ClaudeCodeCredentials | null {
		return this.credentials
	}
}

export const claudeCodeOAuthManager = new ClaudeCodeOAuthManager()
