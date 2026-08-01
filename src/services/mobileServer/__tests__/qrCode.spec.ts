import { describe, it, expect } from "vitest"

import { renderQrSvg } from "../qrCode"

const QUIET_ZONE = 4

type Grid = {
	size: number
	moduleCount: number
	isDark: (row: number, col: number) => boolean
}

/**
 * Parses the rendered SVG back into a module grid so the assertions below can
 * check real QR structure rather than just re-stating the markup template.
 */
function parseQrSvg(svg: string): Grid {
	const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/)
	expect(viewBox).not.toBeNull()

	const size = Number(viewBox![1])
	expect(Number(viewBox![2])).toBe(size)

	const dark = new Set<string>()

	for (const [, col, row] of svg.matchAll(/M(\d+),(\d+)h1v1h-1z/g)) {
		dark.add(`${row},${col}`)
	}

	return {
		size,
		moduleCount: size - QUIET_ZONE * 2,
		isDark: (row, col) => dark.has(`${row + QUIET_ZONE},${col + QUIET_ZONE}`),
	}
}

/**
 * The 7x7 position-detection pattern the spec mandates in three corners:
 * a dark ring, a light ring inside it, and a 3x3 dark core.
 */
function assertFinderPatternAt(grid: Grid, originRow: number, originCol: number): void {
	for (let row = 0; row < 7; row++) {
		for (let col = 0; col < 7; col++) {
			const ring = Math.min(row, col, 6 - row, 6 - col)
			// Rings 0 and 2+ are dark (outer border and the 3x3 core), ring 1 light.
			const expected = ring !== 1

			expect(grid.isDark(originRow + row, originCol + col)).toBe(expected)
		}
	}
}

describe("renderQrSvg", () => {
	const url = "http://192.168.1.42:8790/?token=Zm9vYmFyLWJheg_qux-1234567890abcdefghijkl"

	it("emits a scalable, self-contained SVG with a white backdrop", () => {
		const svg = renderQrSvg(url)

		expect(svg.startsWith("<svg ")).toBe(true)
		expect(svg.endsWith("</svg>")).toBe(true)
		expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
		// No intrinsic width/height - the webview sizes it purely with CSS.
		expect(svg).not.toMatch(/\swidth="\d+px"/)
		expect(svg).toContain('fill="#ffffff"')
		expect(svg).toContain('fill="#000000"')
	})

	it("surrounds the symbol with the spec-mandated 4-module quiet zone", () => {
		const grid = parseQrSvg(renderQrSvg(url))

		// A QR symbol is (17 + 4 * version) modules square, so always odd-sized
		// and at least 21 for version 1.
		expect(grid.moduleCount).toBeGreaterThanOrEqual(21)
		expect(grid.moduleCount % 2).toBe(1)
		expect(grid.size).toBe(grid.moduleCount + QUIET_ZONE * 2)

		// Nothing dark may fall outside the symbol itself.
		for (const [, col, row] of renderQrSvg(url).matchAll(/M(\d+),(\d+)h1v1h-1z/g)) {
			expect(Number(row)).toBeGreaterThanOrEqual(QUIET_ZONE)
			expect(Number(col)).toBeGreaterThanOrEqual(QUIET_ZONE)
			expect(Number(row)).toBeLessThan(QUIET_ZONE + grid.moduleCount)
			expect(Number(col)).toBeLessThan(QUIET_ZONE + grid.moduleCount)
		}
	})

	it("places position-detection patterns in the three expected corners", () => {
		const grid = parseQrSvg(renderQrSvg(url))
		const far = grid.moduleCount - 7

		assertFinderPatternAt(grid, 0, 0)
		assertFinderPatternAt(grid, 0, far)
		assertFinderPatternAt(grid, far, 0)
	})

	it("grows the symbol for longer payloads and stays deterministic", () => {
		const short = parseQrSvg(renderQrSvg("http://10.0.0.2:8790/"))
		const long = parseQrSvg(renderQrSvg(`http://10.0.0.2:8790/?token=${"a".repeat(400)}`))

		expect(long.moduleCount).toBeGreaterThan(short.moduleCount)
		expect(renderQrSvg(url)).toBe(renderQrSvg(url))
	})
})
