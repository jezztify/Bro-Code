import qrcode from "qrcode-generator"

/**
 * Blank border, in modules, required around a QR symbol by the spec - scanners
 * need it to find the symbol's edges. Four is the specified minimum.
 */
const QUIET_ZONE_MODULES = 4

/**
 * Renders `text` as a self-contained, scalable QR SVG string.
 *
 * The markup is built by hand rather than via `createSvgTag()` so the output is
 * a plain `viewBox`-only `<svg>` (no fixed pixel size, no XML prolog) that can
 * be inlined straight into a webview and sized purely with CSS.
 *
 * Colors are hardcoded black-on-white rather than themed: a QR needs dark
 * modules on a light background to scan reliably, so inverting it under a dark
 * VS Code theme would break the one thing it exists to do.
 */
export function renderQrSvg(text: string): string {
	// Type number 0 = pick the smallest version that fits. "M" (~15% recovery)
	// is the usual default: enough resilience for a phone camera pointed at a
	// screen without inflating the symbol the way "Q"/"H" would.
	const qr = qrcode(0, "M")
	qr.addData(text)
	qr.make()

	const moduleCount = qr.getModuleCount()
	const size = moduleCount + QUIET_ZONE_MODULES * 2

	// One `<path>` holding every dark module as a 1x1 subpath - far smaller than
	// emitting a `<rect>` element per module.
	let path = ""

	for (let row = 0; row < moduleCount; row++) {
		for (let col = 0; col < moduleCount; col++) {
			if (qr.isDark(row, col)) {
				path += `M${col + QUIET_ZONE_MODULES},${row + QUIET_ZONE_MODULES}h1v1h-1z`
			}
		}
	}

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
		`<rect width="${size}" height="${size}" fill="#ffffff"/>` +
		`<path fill="#000000" d="${path}"/>` +
		`</svg>`
	)
}
