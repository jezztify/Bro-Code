import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
	root: path.resolve(__dirname),
	test: {
		globals: true,
		include: ["__tests__/**/*.spec.ts"],
		watch: false,
	},
})
