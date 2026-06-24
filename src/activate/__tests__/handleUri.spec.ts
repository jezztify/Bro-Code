vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn(),
	},
}))

import * as vscode from "vscode"

const {
	mockGetVisibleInstance,
	mockGetAllInstances,
	mockHandleBroCodeAuthCallback,
	mockSetBroCodeUserInfo,
	mockVisibleProvider,
} = vi.hoisted(() => {
	const mockVisibleProvider = {
		handleOpenRouterCallback: vi.fn(),
		handleRequestyCallback: vi.fn(),
		handleBroCodeCallback: vi.fn(),
	} as any

	return {
		mockGetVisibleInstance: vi.fn(() => mockVisibleProvider),
		mockGetAllInstances: vi.fn(() => [mockVisibleProvider]),
		mockHandleBroCodeAuthCallback: vi.fn(),
		mockSetBroCodeUserInfo: vi.fn(),
		mockVisibleProvider,
	}
})

vi.mock("../../core/webview/ClineProvider", () => ({
	ClineProvider: {
		getVisibleInstance: mockGetVisibleInstance,
		getAllInstances: mockGetAllInstances,
	},
}))

vi.mock("../../services/bro-code-auth", () => ({
	handleAuthCallback: mockHandleBroCodeAuthCallback,
	setBroCodeUserInfo: mockSetBroCodeUserInfo,
}))

import { handleUri } from "../handleUri"

describe("handleUri", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockGetVisibleInstance.mockReturnValue(mockVisibleProvider)
		mockGetAllInstances.mockReturnValue([mockVisibleProvider])
	})

	it("ignores legacy cloud auth callback", async () => {
		await handleUri({
			path: "/auth/clerk/callback",
			query: "code=test-code&state=test-state&organizationId=test-org",
		} as any)

		expect(mockVisibleProvider.handleOpenRouterCallback).not.toHaveBeenCalled()
		expect(mockVisibleProvider.handleRequestyCallback).not.toHaveBeenCalled()
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			"Bro Code Cloud sign-in is currently unavailable. Configure another provider to continue.",
		)
	})

	it("stores callback user info even when no provider instances exist", async () => {
		mockGetVisibleInstance.mockReturnValue(null)
		mockGetAllInstances.mockReturnValue([])
		mockHandleBroCodeAuthCallback.mockResolvedValue(true)

		await handleUri({
			path: "/auth-callback",
			query: "token=bro_ext_test_token&name=Jane%20Doe&email=jane%40example.com&image=https%3A%2F%2Fexample.com%2Favatar.png",
		} as any)

		expect(mockHandleBroCodeAuthCallback).toHaveBeenCalledWith("bro_ext_test_token")
		expect(mockSetBroCodeUserInfo).toHaveBeenCalledWith({
			name: "Jane Doe",
			email: "jane@example.com",
			image: "https://example.com/avatar.png",
		})
		// No provider instances exist, so handleBroCodeCallback should not be called
		expect(mockVisibleProvider.handleBroCodeCallback).not.toHaveBeenCalled()
	})

	it("refreshes the visible provider after a successful auth callback", async () => {
		mockHandleBroCodeAuthCallback.mockResolvedValue(true)

		await handleUri({
			path: "/auth-callback",
			query: "token=bro_ext_test_token",
		} as any)

		// When no user info is provided, null values are passed to clear stale data
		expect(mockSetBroCodeUserInfo).toHaveBeenCalledWith({
			name: null,
			email: null,
			image: null,
		})
		expect(mockVisibleProvider.handleBroCodeCallback).toHaveBeenCalledWith("bro_ext_test_token")
	})

	it("clears stale user info fields when re-authing with missing fields", async () => {
		mockHandleBroCodeAuthCallback.mockResolvedValue(true)

		// Re-auth with only name - email and image should be cleared
		await handleUri({
			path: "/auth-callback",
			query: "token=bro_ext_test_token&name=John%20Doe",
		} as any)

		expect(mockSetBroCodeUserInfo).toHaveBeenCalledWith({
			name: "John Doe",
			email: null,
			image: null,
		})
	})

	it("does not persist user info when auth callback validation fails", async () => {
		mockHandleBroCodeAuthCallback.mockResolvedValue(false)

		await handleUri({
			path: "/auth-callback",
			query: "token=bro_ext_test_token&name=Jane%20Doe",
		} as any)

		expect(mockSetBroCodeUserInfo).not.toHaveBeenCalled()
		expect(mockVisibleProvider.handleBroCodeCallback).not.toHaveBeenCalled()
	})

	it("propagates the callback token to every ClineProvider instance, not just the visible one", async () => {
		// Regression: prior to multi-instance fan-out, hidden providers (sidebar collapsed,
		// secondary panels) never received the broSessionToken, so their profile settings
		// stayed unauthenticated until reload.
		mockHandleBroCodeAuthCallback.mockResolvedValue(true)

		const hiddenProvider = { handleBroCodeCallback: vi.fn() } as any
		const secondHidden = { handleBroCodeCallback: vi.fn() } as any
		mockGetAllInstances.mockReturnValue([mockVisibleProvider, hiddenProvider, secondHidden])

		await handleUri({
			path: "/auth-callback",
			query: "token=bro_ext_test_token",
		} as any)

		expect(mockHandleBroCodeAuthCallback).toHaveBeenCalledWith("bro_ext_test_token")
		expect(mockSetBroCodeUserInfo).toHaveBeenCalled()
		expect(mockVisibleProvider.handleBroCodeCallback).toHaveBeenCalledWith("bro_ext_test_token")
		expect(hiddenProvider.handleBroCodeCallback).toHaveBeenCalledWith("bro_ext_test_token")
		expect(secondHidden.handleBroCodeCallback).toHaveBeenCalledWith("bro_ext_test_token")
	})

	it("serializes callbacks across instances to avoid concurrent profile-store writes", async () => {
		// Regression: a previous implementation used Promise.all which fanned out concurrent
		// read-modify-write operations on the same provider settings store. Verify the
		// callbacks are invoked sequentially.
		mockHandleBroCodeAuthCallback.mockResolvedValue(true)

		const order: string[] = []
		const makeProvider = (name: string) =>
			({
				handleBroCodeCallback: vi.fn(async () => {
					order.push(`${name}:start`)
					// Yield to the event loop so a concurrent call would interleave.
					await new Promise((resolve) => setTimeout(resolve, 0))
					order.push(`${name}:end`)
				}),
			}) as any

		const a = makeProvider("a")
		const b = makeProvider("b")
		mockGetAllInstances.mockReturnValue([a, b])

		await handleUri({
			path: "/auth-callback",
			query: "token=bro_ext_test_token",
		} as any)

		expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"])
	})

	it("continues fan-out when one instance fails to persist the callback token", async () => {
		mockHandleBroCodeAuthCallback.mockResolvedValue(true)

		const failingProvider = {
			handleBroCodeCallback: vi.fn(async () => {
				throw new Error("profile store unavailable")
			}),
		} as any
		const healthyProvider = { handleBroCodeCallback: vi.fn() } as any
		mockGetAllInstances.mockReturnValue([failingProvider, healthyProvider])

		await handleUri({
			path: "/auth-callback",
			query: "token=bro_ext_test_token",
		} as any)

		expect(failingProvider.handleBroCodeCallback).toHaveBeenCalledWith("bro_ext_test_token")
		expect(healthyProvider.handleBroCodeCallback).toHaveBeenCalledWith("bro_ext_test_token")
	})
})
