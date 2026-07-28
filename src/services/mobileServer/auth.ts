import * as crypto from "crypto"

/** Name of the signed session cookie issued after a successful `?token=` GET. */
export const SESSION_COOKIE_NAME = "zoo_mobile_session"

/** How long an issued session cookie remains valid for, in milliseconds. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours

/**
 * Generates a random per-server-start pairing token (decision 1: no accounts,
 * no cross-restart persistence). 32 bytes of entropy, base64url-encoded so it's
 * safe to embed directly in a URL query string.
 */
export function generatePairingToken(): string {
	return crypto.randomBytes(32).toString("base64url")
}

/**
 * Generates a random per-server-start HMAC secret used to sign session cookies.
 * Kept in memory only, alongside the pairing token - both are invalidated when
 * the server stops/restarts.
 */
export function generateCookieSecret(): string {
	return crypto.randomBytes(32).toString("base64url")
}

interface SessionPayload {
	/** Epoch ms after which the session cookie is no longer valid. */
	exp: number
}

function sign(secret: string, payload: string): string {
	return crypto.createHmac("sha256", secret).update(payload).digest("base64url")
}

/**
 * Creates a short-lived signed session cookie value (payload + HMAC signature,
 * dot-separated) issued after a valid `?token=` is presented, so the pairing
 * token itself doesn't need to be repeated on every sub-resource request.
 */
export function createSessionCookie(secret: string, now: number = Date.now()): string {
	const payload: SessionPayload = { exp: now + SESSION_TTL_MS }
	const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
	const signature = sign(secret, encodedPayload)
	return `${encodedPayload}.${signature}`
}

/**
 * Verifies a session cookie value against the server's in-memory HMAC secret.
 * Returns `true` only if the signature matches (constant-time compare) and the
 * embedded expiry hasn't passed.
 */
export function verifySessionCookie(
	secret: string,
	cookieValue: string | undefined,
	now: number = Date.now(),
): boolean {
	if (!cookieValue) {
		return false
	}

	const separatorIndex = cookieValue.indexOf(".")

	if (separatorIndex === -1) {
		return false
	}

	const encodedPayload = cookieValue.slice(0, separatorIndex)
	const signature = cookieValue.slice(separatorIndex + 1)
	const expectedSignature = sign(secret, encodedPayload)

	const signatureBuffer = Buffer.from(signature, "base64url")
	const expectedBuffer = Buffer.from(expectedSignature, "base64url")

	if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
		return false
	}

	try {
		const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as SessionPayload
		return typeof payload.exp === "number" && payload.exp > now
	} catch {
		return false
	}
}

/**
 * Constant-time comparison of a request's `?token=` query param against the
 * server's pairing token. Both values are hashed first so the comparison is
 * constant-time even when the two strings differ in length.
 */
export function verifyPairingToken(expectedToken: string, providedToken: string | undefined | null): boolean {
	if (!providedToken) {
		return false
	}

	const expectedHash = crypto.createHash("sha256").update(expectedToken).digest()
	const providedHash = crypto.createHash("sha256").update(providedToken).digest()

	return crypto.timingSafeEqual(expectedHash, providedHash)
}

/** Parses a `Cookie` request header into a name -> value map. */
export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
	const cookies: Record<string, string> = {}

	if (!cookieHeader) {
		return cookies
	}

	for (const part of cookieHeader.split(";")) {
		const separatorIndex = part.indexOf("=")

		if (separatorIndex === -1) {
			continue
		}

		const name = part.slice(0, separatorIndex).trim()
		const value = part.slice(separatorIndex + 1).trim()

		if (name) {
			cookies[name] = decodeURIComponent(value)
		}
	}

	return cookies
}

/** Builds a `Set-Cookie` header value for the session cookie (HttpOnly, SameSite=Strict). */
export function buildSessionCookieHeader(value: string): string {
	const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000)
	return `${SESSION_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`
}
