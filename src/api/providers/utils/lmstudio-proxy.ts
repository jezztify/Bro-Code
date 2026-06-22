import { Agent, ProxyAgent, fetch as undiciFetch } from "undici"

export interface LmStudioProxyOptions {
	lmStudioBypassProxy?: boolean
	lmStudioProxyUrl?: string
}

export interface LmStudioFetchConfig {
	dispatcher: Agent | ProxyAgent
	/**
	 * Set when requests need to bypass VS Code's `globalThis.fetch` patch (which routes through the
	 * system proxy) — either because the user opted out of the system proxy entirely, or because a
	 * custom proxy URL should be used instead.
	 */
	fetch?: typeof fetch
}

/**
 * Builds the dispatcher (and, when needed, the fetch implementation) used to route LM Studio
 * requests through the user's configured proxy settings. Shared between the chat completion
 * handler and the connection test so both follow the same proxy/bypass rules.
 */
export function getLmStudioFetchConfig(options: LmStudioProxyOptions, timeoutMs: number): LmStudioFetchConfig {
	const bypassProxy = options.lmStudioBypassProxy
	const proxyUrl = bypassProxy ? undefined : options.lmStudioProxyUrl?.trim()

	const dispatcher = proxyUrl
		? new ProxyAgent({
				uri: proxyUrl,
				headersTimeout: timeoutMs,
				bodyTimeout: timeoutMs,
				// LM Studio is served over plain HTTP on the local network, so forward it through the
				// proxy the same way curl/env-proxy do (a rewritten request) instead of an HTTP CONNECT
				// tunnel — undici defaults to tunneling, which many local/LAN proxies don't expect for
				// non-TLS targets and reject or hang on.
				proxyTunnel: false,
			})
		: new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs })

	return {
		dispatcher,
		...(bypassProxy || proxyUrl ? { fetch: undiciFetch as unknown as typeof fetch } : {}),
	}
}

export interface LmStudioConnectionTestResult {
	success: boolean
	error?: string
	modelCount?: number
}

/**
 * Hits LM Studio's OpenAI-compatible `/v1/models` endpoint using the same proxy/bypass rules as
 * the chat completion handler, so the result reflects what an actual request would do.
 */
export async function testLmStudioConnection(
	baseUrl: string | undefined,
	proxyOptions: LmStudioProxyOptions,
	timeoutMs = 10_000,
): Promise<LmStudioConnectionTestResult> {
	const url = (baseUrl?.trim() || "http://localhost:1234").replace(/\/+$/, "")

	if (!URL.canParse(url)) {
		return { success: false, error: `Invalid base URL: ${url}` }
	}

	const { dispatcher, fetch: lmStudioFetch } = getLmStudioFetchConfig(proxyOptions, timeoutMs)
	const doFetch = lmStudioFetch ?? (globalThis.fetch as typeof fetch)

	try {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), timeoutMs)

		try {
			const response = await doFetch(`${url}/v1/models`, {
				signal: controller.signal,
				// `dispatcher` is an undici-specific fetch option not present in the DOM fetch types.
				...({ dispatcher } as Record<string, unknown>),
			})

			if (!response.ok) {
				return { success: false, error: `HTTP ${response.status} ${response.statusText}` }
			}

			const body = await response.json()
			const modelCount = Array.isArray(body?.data) ? body.data.length : undefined
			return { success: true, modelCount }
		} finally {
			clearTimeout(timeout)
		}
	} catch (error) {
		return { success: false, error: describeFetchError(error) }
	}
}

/**
 * undici's fetch wraps the real failure reason in `error.cause` (e.g. ECONNREFUSED, proxy tunnel
 * rejection) and only surfaces the generic "fetch failed" on `error.message`. Walk the cause chain
 * so the logged error is actually actionable.
 */
function describeFetchError(error: unknown): string {
	if (!(error instanceof Error)) {
		return String(error)
	}

	const parts: string[] = []
	let current: unknown = error

	while (current instanceof Error) {
		if (!parts.includes(current.message)) {
			parts.push(current.message)
		}
		current = current.cause
	}

	return parts.join(" -> ")
}
