import { describe, it, expect } from "vitest"

import {
	generatePairingToken,
	generateCookieSecret,
	createSessionCookie,
	verifySessionCookie,
	verifyPairingToken,
	parseCookies,
	buildSessionCookieHeader,
	SESSION_COOKIE_NAME,
	SESSION_TTL_MS,
} from "../auth"

describe("generatePairingToken / generateCookieSecret", () => {
	it("generates sufficiently long, url-safe, unique values", () => {
		const a = generatePairingToken()
		const b = generatePairingToken()

		expect(a).not.toBe(b)
		expect(a.length).toBeGreaterThan(30)
		expect(a).toMatch(/^[A-Za-z0-9_-]+$/)

		const secretA = generateCookieSecret()
		const secretB = generateCookieSecret()
		expect(secretA).not.toBe(secretB)
	})
})

describe("verifyPairingToken", () => {
	it("accepts the exact expected token", () => {
		expect(verifyPairingToken("expected-token", "expected-token")).toBe(true)
	})

	it("rejects a wrong token", () => {
		expect(verifyPairingToken("expected-token", "wrong-token")).toBe(false)
	})

	it("rejects a missing token", () => {
		expect(verifyPairingToken("expected-token", undefined)).toBe(false)
		expect(verifyPairingToken("expected-token", null)).toBe(false)
		expect(verifyPairingToken("expected-token", "")).toBe(false)
	})

	it("rejects tokens of a different length without throwing", () => {
		expect(verifyPairingToken("short", "a-much-longer-provided-token")).toBe(false)
	})
})

describe("session cookies", () => {
	it("round-trips a freshly issued cookie as valid", () => {
		const secret = generateCookieSecret()
		const cookie = createSessionCookie(secret)

		expect(verifySessionCookie(secret, cookie)).toBe(true)
	})

	it("rejects a cookie signed with a different secret", () => {
		const cookie = createSessionCookie(generateCookieSecret())

		expect(verifySessionCookie(generateCookieSecret(), cookie)).toBe(false)
	})

	it("rejects a tampered payload", () => {
		const secret = generateCookieSecret()
		const cookie = createSessionCookie(secret)
		const [, signature] = cookie.split(".")
		const tampered = `${Buffer.from(JSON.stringify({ exp: Date.now() + 999_999_999 })).toString("base64url")}.${signature}`

		expect(verifySessionCookie(secret, tampered)).toBe(false)
	})

	it("rejects an expired cookie", () => {
		const secret = generateCookieSecret()
		const issuedAt = 1_000_000
		const cookie = createSessionCookie(secret, issuedAt)

		expect(verifySessionCookie(secret, cookie, issuedAt + SESSION_TTL_MS + 1)).toBe(false)
		expect(verifySessionCookie(secret, cookie, issuedAt + SESSION_TTL_MS - 1)).toBe(true)
	})

	it("rejects missing/malformed cookie values", () => {
		const secret = generateCookieSecret()

		expect(verifySessionCookie(secret, undefined)).toBe(false)
		expect(verifySessionCookie(secret, "")).toBe(false)
		expect(verifySessionCookie(secret, "not-a-valid-cookie")).toBe(false)
	})
})

describe("parseCookies", () => {
	it("parses a single cookie", () => {
		expect(parseCookies(`${SESSION_COOKIE_NAME}=abc123`)).toEqual({ [SESSION_COOKIE_NAME]: "abc123" })
	})

	it("parses multiple cookies separated by semicolons", () => {
		expect(parseCookies(`foo=bar; ${SESSION_COOKIE_NAME}=abc123; baz=qux`)).toEqual({
			foo: "bar",
			[SESSION_COOKIE_NAME]: "abc123",
			baz: "qux",
		})
	})

	it("returns an empty object for an undefined header", () => {
		expect(parseCookies(undefined)).toEqual({})
	})

	it("URL-decodes cookie values", () => {
		expect(parseCookies("foo=bar%20baz")).toEqual({ foo: "bar baz" })
	})
})

describe("buildSessionCookieHeader", () => {
	it("builds an HttpOnly, SameSite=Strict cookie header with the session name", () => {
		const header = buildSessionCookieHeader("some-value")

		expect(header).toContain(`${SESSION_COOKIE_NAME}=some-value`)
		expect(header).toContain("HttpOnly")
		expect(header).toContain("SameSite=Strict")
		expect(header).toContain("Path=/")
	})
})
