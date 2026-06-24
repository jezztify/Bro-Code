import { describe, it, expect } from "vitest"
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

import { generateBromodesJsonSchema } from "../bromodes-schema.js"

/**
 * This test verifies that the checked-in schemas/bromodes.json matches what
 * would be generated from the current Zod schemas. If this test fails, run:
 *
 *   pnpm --filter @bro-code/types generate:schema
 *
 * to regenerate the schema file.
 */
describe("bromodes schema sync", () => {
	it("should match the dynamically generated schema from Zod types", () => {
		const __dirname = path.dirname(fileURLToPath(import.meta.url))
		const schemaPath = path.resolve(__dirname, "../../../../schemas/bromodes.json")
		const checkedIn = JSON.parse(fs.readFileSync(schemaPath, "utf-8"))

		const generated = generateBromodesJsonSchema()

		expect(checkedIn).toEqual(generated)
	})
})
