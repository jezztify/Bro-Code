import * as vscode from "vscode"

import { t } from "../i18n"

const BRO_CODE_TOKEN_KEY = "bro-code-session-token"
const BRO_CODE_USER_NAME_KEY = "bro-code-user-name"
const BRO_CODE_USER_EMAIL_KEY = "bro-code-user-email"
const BRO_CODE_USER_IMAGE_KEY = "bro-code-user-image"

let secretStorage: vscode.SecretStorage | undefined

// In-memory cache for synchronous access in BroCodeHandler hot path
let _cachedToken: string | undefined = undefined
let _sessionCleared = false
let _cachedUserName: string | undefined = undefined
let _cachedUserEmail: string | undefined = undefined
let _cachedUserImage: string | undefined = undefined

export async function initBroCodeAuth(context: vscode.ExtensionContext): Promise<void> {
	if (!context.secrets) {
		// Secret storage unavailable (e.g. test environment without secrets mock).
		// Treat as unauthenticated startup — all cached values remain undefined.
		return
	}
	secretStorage = context.secrets

	// Pre-load the token and user info into memory on init so BroCodeHandler can access them synchronously
	_cachedToken = await secretStorage.get(BRO_CODE_TOKEN_KEY)
	_sessionCleared = false
	_cachedUserName = await secretStorage.get(BRO_CODE_USER_NAME_KEY)
	_cachedUserEmail = await secretStorage.get(BRO_CODE_USER_EMAIL_KEY)
	_cachedUserImage = await secretStorage.get(BRO_CODE_USER_IMAGE_KEY)

	// Validate persisted auth state on init before reporting the user as connected.
	// Network errors / 5xx ("unreachable") leave the cached session in place so a
	// transient backend blip doesn't force users to sign in again.
	if (_cachedToken) {
		const result = await verifyBroCodeToken()
		if (result === "invalid") {
			await clearBroCodeUserInfo()
			await clearBroCodeToken()
		}
	}

	// Watch for secret changes and update cache
	context.secrets.onDidChange((e) => {
		if (e.key === BRO_CODE_TOKEN_KEY) {
			secretStorage?.get(BRO_CODE_TOKEN_KEY).then((token) => {
				_cachedToken = token
			})
		}
		if (e.key === BRO_CODE_USER_NAME_KEY) {
			secretStorage?.get(BRO_CODE_USER_NAME_KEY).then((name) => {
				_cachedUserName = name
			})
		}
		if (e.key === BRO_CODE_USER_EMAIL_KEY) {
			secretStorage?.get(BRO_CODE_USER_EMAIL_KEY).then((email) => {
				_cachedUserEmail = email
			})
		}
		if (e.key === BRO_CODE_USER_IMAGE_KEY) {
			secretStorage?.get(BRO_CODE_USER_IMAGE_KEY).then((image) => {
				_cachedUserImage = image
			})
		}
	})
}

// Synchronous getter for use in BroCodeHandler (called in hot path during API requests)
export function getCachedBroCodeToken(): string {
	return _cachedToken ?? ""
}

/**
 * Resolves the Bro Gateway session token for API calls.
 * Secret-storage cache wins over profile-persisted tokens; after an explicit sign-out
 * or 401 clear, profile tokens are ignored so stale credentials cannot be reused.
 */
export function resolveBroGatewaySessionToken(profileToken?: string): string | undefined {
	if (_cachedToken) {
		return _cachedToken
	}
	if (_sessionCleared) {
		return undefined
	}
	return profileToken || undefined
}

export function getCachedBroCodeUserInfo(): { name?: string; email?: string; image?: string } {
	return {
		name: _cachedUserName,
		email: _cachedUserEmail,
		image: _cachedUserImage,
	}
}

export async function getBroCodeToken(): Promise<string | undefined> {
	if (!secretStorage) return undefined
	return secretStorage.get(BRO_CODE_TOKEN_KEY)
}

export async function setBroCodeToken(token: string): Promise<void> {
	if (!secretStorage) return
	await secretStorage.store(BRO_CODE_TOKEN_KEY, token)
	_cachedToken = token
	_sessionCleared = false
}

export async function setBroCodeUserInfo(info: {
	name?: string | null
	email?: string | null
	image?: string | null
}): Promise<void> {
	if (!secretStorage) return

	if (info.name) {
		await secretStorage.store(BRO_CODE_USER_NAME_KEY, info.name)
		_cachedUserName = info.name
	} else if (info.name === null) {
		await secretStorage.delete(BRO_CODE_USER_NAME_KEY)
		_cachedUserName = undefined
	}

	if (info.email) {
		await secretStorage.store(BRO_CODE_USER_EMAIL_KEY, info.email)
		_cachedUserEmail = info.email
	} else if (info.email === null) {
		await secretStorage.delete(BRO_CODE_USER_EMAIL_KEY)
		_cachedUserEmail = undefined
	}

	if (info.image) {
		await secretStorage.store(BRO_CODE_USER_IMAGE_KEY, info.image)
		_cachedUserImage = info.image
	} else if (info.image === null) {
		await secretStorage.delete(BRO_CODE_USER_IMAGE_KEY)
		_cachedUserImage = undefined
	}
}

export async function clearBroCodeUserInfo(): Promise<void> {
	if (!secretStorage) return
	await secretStorage.delete(BRO_CODE_USER_NAME_KEY)
	await secretStorage.delete(BRO_CODE_USER_EMAIL_KEY)
	await secretStorage.delete(BRO_CODE_USER_IMAGE_KEY)
	_cachedUserName = undefined
	_cachedUserEmail = undefined
	_cachedUserImage = undefined
}

export async function clearBroCodeToken(): Promise<void> {
	if (!secretStorage) return
	await secretStorage.delete(BRO_CODE_TOKEN_KEY)
	_cachedToken = undefined
	_sessionCleared = true
}

export function getBroCodeBaseUrl(): string {
	return process.env.BRO_CODE_BASE_URL || "https://www.brocode.dev"
}

export async function handleAuthCallback(token: string): Promise<boolean> {
	if (!token || !token.startsWith("bro_ext_")) {
		vscode.window.showErrorMessage(t("common:broAuth.errors.invalid_token_received"))
		return false
	}

	// Verify token with backend before storing
	const baseUrl = getBroCodeBaseUrl()
	try {
		const response = await fetch(`${baseUrl}/api/extension/auth/verify`, {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(10_000),
		})
		if (!response.ok) {
			// Treat 5xx as a transient backend issue (e.g. DB unreachable) so the
			// user can retry sign-in instead of being told the token is bad.
			if (response.status >= 500) {
				vscode.window.showErrorMessage(t("common:broAuth.errors.could_not_verify_token"))
			} else {
				vscode.window.showErrorMessage(t("common:broAuth.errors.token_verification_failed"))
			}
			return false
		}
		const data = (await response.json()) as { valid?: boolean }
		if (!data.valid) {
			vscode.window.showErrorMessage(t("common:broAuth.errors.invalid_token"))
			return false
		}
	} catch {
		vscode.window.showErrorMessage(t("common:broAuth.errors.could_not_verify_token"))
		return false
	}

	await setBroCodeToken(token)

	vscode.window.showInformationMessage(t("common:broAuth.info.connected"))
	return true
}

/**
 * Verify the stored token against the backend.
 * Returns:
 *   - "valid"       — backend confirmed the token is good
 *   - "invalid"     — backend explicitly rejected the token (4xx or valid: false)
 *   - "unreachable" — network error / timeout / 5xx backend error; token state is unknown
 *
 * 5xx responses are treated as transient: the website returns 503 when the
 * database is unreachable, and clearing a real session on a backend hiccup
 * forces users to sign in again every time the API blips.
 *
 * This function has no side-effects; callers are responsible for acting on the result.
 */
export async function verifyBroCodeToken(): Promise<"valid" | "invalid" | "unreachable"> {
	const token = await getBroCodeToken()
	if (!token) return "invalid"

	const baseUrl = getBroCodeBaseUrl()

	try {
		const response = await fetch(`${baseUrl}/api/extension/auth/verify`, {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(10_000),
		})

		if (!response.ok) {
			if (response.status >= 500) {
				return "unreachable"
			}
			return "invalid"
		}

		const data = (await response.json()) as { valid?: boolean }
		return data.valid === true ? "valid" : "invalid"
	} catch {
		return "unreachable"
	}
}

export async function isBroCodeAuthenticated(): Promise<boolean> {
	const token = await getBroCodeToken()
	return !!token
}

export async function disconnectBroCode(): Promise<void> {
	const token = await getBroCodeToken()
	if (token) {
		const baseUrl = getBroCodeBaseUrl()

		try {
			await fetch(`${baseUrl}/api/extension/auth/revoke`, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				signal: AbortSignal.timeout(10_000),
			})
		} catch {
			// Ignore errors during revocation
		}
	}
	await clearBroCodeToken()
	await clearBroCodeUserInfo()
	vscode.window.showInformationMessage(t("common:broAuth.info.disconnected"))
}
