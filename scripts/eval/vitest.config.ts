import path from "path"

// Plain config object rather than `defineConfig` from "vitest/config": scripts/eval
// is intentionally not a pnpm workspace package (see README.md), so it has no local
// `node_modules` of its own to resolve that import from. `defineConfig` is purely a
// type-inference helper at runtime, so a plain object works identically - run this
// with a vitest binary resolvable from elsewhere in the repo, e.g.
// `cd src && node_modules/.bin/vitest run --config ../scripts/eval/vitest.config.ts`.
export default {
	root: path.resolve(__dirname),
	test: {
		globals: true,
		include: ["__tests__/**/*.spec.ts"],
		watch: false,
	},
}
