/**
 * `window.ZOO_MOBILE_MODE` is a static bootstrap global set once by
 * `htmlInjection.ts` when `MobileServer` serves this bundle to a phone
 * browser - it never changes over the page's lifetime, so this doesn't need
 * `useState`/`useEffect` machinery, just a direct read. Kept as a hook (rather
 * than a plain export) so call sites read naturally alongside other React
 * hooks and so a future reactive source (if ever needed) can swap in without
 * changing callers.
 *
 * Used to gate the mobile-only native-dialog replacements (in-page image
 * picker/lightbox) added for the mobile-server feature - falsy/no-op on
 * desktop, so the existing desktop behavior and test suite are unaffected.
 */
export function useMobileMode(): boolean {
	return (
		typeof window !== "undefined" && (window as unknown as { ZOO_MOBILE_MODE?: boolean }).ZOO_MOBILE_MODE === true
	)
}
