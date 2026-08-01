import type { ExtensionMessage } from "@roo-code/types"

/**
 * Identifies one webview-hosting surface (a sidebar view, an editor-tab panel,
 * or a detached board window). Opaque to subscribers - they only ever compare
 * it for equality against {@link WebviewHub.activeProviderId}.
 */
export type ProviderId = string

export interface HubMessage {
	providerId: ProviderId
	message: ExtensionMessage
}

export type HubMessageListener = (entry: HubMessage) => void
export type ActiveProviderListener = (providerId: ProviderId | undefined) => void

/**
 * The surface of a provider the hub needs, kept structural on purpose.
 *
 * `ClineProvider` satisfies this without declaring it, which lets consumers
 * (notably `MobileServer`) resolve a provider through the hub using a *type-only*
 * import of `ClineProvider`. Handing out concrete instances from a static on
 * `ClineProvider` instead would turn that erased import into a runtime one and
 * pull a 5k-line module - and its whole dependency graph - into every consumer.
 */
export interface HubProvider {
	readonly providerId: ProviderId
	/**
	 * Assembles a state snapshot *without* sending it anywhere. Consumers that
	 * only want to refresh their own clients use this rather than
	 * `postStateToWebview()`, which would also push to the provider's desktop
	 * webview and disturb an in-flight message stream there.
	 */
	getStateToPostToWebview(): Promise<unknown>
}

/** Minimal disposable so this module needs no `vscode` import (keeps it unit-testable). */
export interface HubSubscription {
	dispose(): void
}

/**
 * Host-level fan-out point for everything a `ClineProvider` sends to its webview.
 *
 * Every provider in the extension host publishes here, tagged with its own
 * {@link ProviderId}. Out-of-band consumers - currently just `MobileServer` -
 * subscribe once and see the whole host rather than a single provider, which is
 * what a phone client needs: tasks started from the board run in editor-tab
 * providers, not the sidebar one the mobile server used to be bound to, so
 * their message stream never reached the socket.
 *
 * Deliberately *additive*: `ClineProvider.postMessageToWebview` still posts to
 * its own `this.view` and its own instance-level listeners exactly as before.
 * This hub only adds a host-wide tap.
 *
 * Nothing here is a source of truth for task state - it is purely an output
 * edge. Task ownership still lives in each provider's `TaskRegistry`; hoisting
 * that is a separate, much larger change.
 */
class WebviewHubImpl {
	private messageListeners = new Set<HubMessageListener>()
	private activeListeners = new Set<ActiveProviderListener>()
	private registered = new Map<ProviderId, HubProvider>()
	private active?: ProviderId

	/**
	 * The surface the user most recently interacted with.
	 *
	 * Deliberately *sticky*: it holds the last provider that was actually used
	 * rather than re-deriving visibility on read. `ClineProvider.getVisibleInstance()`
	 * returns `undefined` whenever the VS Code window is minimized or
	 * backgrounded - exactly when a phone client is most useful - so a
	 * visibility-derived answer would strand the phone precisely when it matters.
	 */
	get activeProviderId(): ProviderId | undefined {
		return this.active
	}

	/**
	 * Announces a provider to the hub. The first provider to register also
	 * becomes the active one, so a host with only a sidebar open never sits with
	 * an undefined focus waiting for a visibility event that already fired.
	 */
	register(provider: HubProvider): void {
		this.registered.set(provider.providerId, provider)

		if (this.active === undefined) {
			this.setActive(provider.providerId)
		}
	}

	/** Resolves an id back to its provider, or `undefined` if it has been disposed. */
	getProvider(providerId: ProviderId | undefined): HubProvider | undefined {
		return providerId === undefined ? undefined : this.registered.get(providerId)
	}

	/**
	 * Drops a disposed provider. If it was the active one, focus falls back to
	 * any surviving provider rather than going undefined - a phone mirroring a
	 * closed editor tab should land back on whatever window is still open
	 * instead of going blank.
	 */
	unregister(providerId: ProviderId): void {
		this.registered.delete(providerId)

		if (this.active === providerId) {
			this.setActive(this.registered.keys().next().value)
		}
	}

	/** Marks a provider as the one the user is working in. No-op if unchanged. */
	markActive(providerId: ProviderId): void {
		if (!this.registered.has(providerId) || this.active === providerId) {
			return
		}

		this.setActive(providerId)
	}

	private setActive(providerId: ProviderId | undefined): void {
		this.active = providerId

		for (const listener of this.activeListeners) {
			try {
				listener(providerId)
			} catch {
				// A misbehaving subscriber must not break provider bookkeeping.
			}
		}
	}

	/**
	 * Fans a provider's outbound message out to every subscriber. Called
	 * synchronously from `postMessageToWebview`, so subscribers observe messages
	 * in exactly the order they were produced.
	 */
	publish(providerId: ProviderId, message: ExtensionMessage): void {
		if (this.messageListeners.size === 0) {
			return
		}

		for (const listener of this.messageListeners) {
			try {
				listener({ providerId, message })
			} catch {
				// Swallowed for the same reason `postMessageToWebview` swallows
				// listener throws: one bad consumer must not break the webview.
			}
		}
	}

	subscribe(listener: HubMessageListener): HubSubscription {
		this.messageListeners.add(listener)
		return { dispose: () => this.messageListeners.delete(listener) }
	}

	onActiveChanged(listener: ActiveProviderListener): HubSubscription {
		this.activeListeners.add(listener)
		return { dispose: () => this.activeListeners.delete(listener) }
	}

	/** Test-only reset; the hub is a module singleton for the life of the host. */
	reset(): void {
		this.messageListeners.clear()
		this.activeListeners.clear()
		this.registered.clear()
		this.active = undefined
	}
}

export const WebviewHub = new WebviewHubImpl()
