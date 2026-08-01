import { describe, it, expect, beforeEach, vi } from "vitest"

import type { ExtensionMessage } from "@roo-code/types"

import { WebviewHub, type HubProvider } from "../WebviewHub"

const message = (text: string) => ({ type: "say", text }) as unknown as ExtensionMessage

/** Stands in for a `ClineProvider`, which satisfies `HubProvider` structurally. */
const stubProvider = (providerId: string): HubProvider => ({
	providerId,
	getStateToPostToWebview: vi.fn().mockResolvedValue({}),
})

describe("WebviewHub", () => {
	beforeEach(() => {
		WebviewHub.reset()
	})

	describe("publish/subscribe", () => {
		it("delivers messages from every registered provider, tagged with its id", () => {
			WebviewHub.register(stubProvider("sidebar"))
			WebviewHub.register(stubProvider("editor-tab"))

			const received: Array<{ providerId: string; text?: string }> = []
			WebviewHub.subscribe(({ providerId, message }) =>
				received.push({ providerId, text: (message as { text?: string }).text }),
			)

			WebviewHub.publish("sidebar", message("from sidebar"))
			WebviewHub.publish("editor-tab", message("from tab"))

			// The regression this hub exists for: a message from an editor-tab
			// provider must reach out-of-band consumers, not just the sidebar's.
			expect(received).toEqual([
				{ providerId: "sidebar", text: "from sidebar" },
				{ providerId: "editor-tab", text: "from tab" },
			])
		})

		it("preserves publish order so subscribers can rely on it for sequencing", () => {
			WebviewHub.register(stubProvider("p1"))

			const texts: Array<string | undefined> = []
			WebviewHub.subscribe(({ message }) => texts.push((message as { text?: string }).text))

			for (const text of ["a", "b", "c"]) {
				WebviewHub.publish("p1", message(text))
			}

			expect(texts).toEqual(["a", "b", "c"])
		})

		it("stops delivering after the subscription is disposed", () => {
			WebviewHub.register(stubProvider("p1"))

			const listener = vi.fn()
			const subscription = WebviewHub.subscribe(listener)

			WebviewHub.publish("p1", message("before"))
			subscription.dispose()
			WebviewHub.publish("p1", message("after"))

			expect(listener).toHaveBeenCalledTimes(1)
		})

		it("keeps delivering to surviving subscribers when one throws", () => {
			WebviewHub.register(stubProvider("p1"))

			const healthy = vi.fn()
			WebviewHub.subscribe(() => {
				throw new Error("boom")
			})
			WebviewHub.subscribe(healthy)

			expect(() => WebviewHub.publish("p1", message("x"))).not.toThrow()
			expect(healthy).toHaveBeenCalledTimes(1)
		})
	})

	describe("active provider tracking", () => {
		it("makes the first registered provider active so focus is never undefined", () => {
			WebviewHub.register(stubProvider("sidebar"))

			expect(WebviewHub.activeProviderId).toBe("sidebar")
		})

		it("does not steal focus when a later provider registers", () => {
			WebviewHub.register(stubProvider("sidebar"))
			WebviewHub.register(stubProvider("editor-tab"))

			expect(WebviewHub.activeProviderId).toBe("sidebar")
		})

		it("moves focus on markActive and notifies listeners", () => {
			WebviewHub.register(stubProvider("sidebar"))
			WebviewHub.register(stubProvider("editor-tab"))

			const onActive = vi.fn()
			WebviewHub.onActiveChanged(onActive)

			WebviewHub.markActive("editor-tab")

			expect(WebviewHub.activeProviderId).toBe("editor-tab")
			expect(onActive).toHaveBeenCalledWith("editor-tab")
		})

		it("stays quiet when markActive names the provider that is already active", () => {
			WebviewHub.register(stubProvider("sidebar"))

			const onActive = vi.fn()
			WebviewHub.onActiveChanged(onActive)

			WebviewHub.markActive("sidebar")

			expect(onActive).not.toHaveBeenCalled()
		})

		it("ignores markActive for an unregistered provider", () => {
			WebviewHub.register(stubProvider("sidebar"))

			WebviewHub.markActive("never-registered")

			expect(WebviewHub.activeProviderId).toBe("sidebar")
		})

		it("falls back to a surviving provider when the active one is unregistered", () => {
			WebviewHub.register(stubProvider("sidebar"))
			WebviewHub.register(stubProvider("editor-tab"))
			WebviewHub.markActive("editor-tab")

			// Closing the tab the phone was mirroring must land it on the still-open
			// sidebar rather than leaving it with no source at all.
			WebviewHub.unregister("editor-tab")

			expect(WebviewHub.activeProviderId).toBe("sidebar")
		})

		it("clears focus only when the last provider goes away", () => {
			WebviewHub.register(stubProvider("sidebar"))
			WebviewHub.unregister("sidebar")

			expect(WebviewHub.activeProviderId).toBeUndefined()
		})

		it("leaves focus alone when a non-active provider is unregistered", () => {
			WebviewHub.register(stubProvider("sidebar"))
			WebviewHub.register(stubProvider("editor-tab"))

			WebviewHub.unregister("editor-tab")

			expect(WebviewHub.activeProviderId).toBe("sidebar")
		})
	})
})
