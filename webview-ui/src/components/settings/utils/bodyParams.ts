/**
 * Helpers for the "custom body parameters" setting, which lets a user add
 * arbitrary top-level key/value pairs to the JSON request body.
 *
 * Values are entered as text but sent as JSON, so `true` becomes a boolean,
 * `42` a number, `{"a":1}` an object, and anything that isn't valid JSON is
 * sent as a plain string.
 */

/**
 * Parses a single value entered in the UI into the value that will be sent.
 */
export const parseBodyParamValue = (value: string): unknown => {
	const trimmed = value.trim()

	if (!trimmed) {
		return ""
	}

	try {
		return JSON.parse(trimmed)
	} catch {
		return value
	}
}

/**
 * Converts an array of [key, value] tuples into the object stored in settings.
 */
export const convertBodyParamsToObject = (params: [string, string][]): Record<string, unknown> => {
	const result: Record<string, unknown> = {}

	for (const [key, value] of params) {
		const trimmedKey = key.trim()

		// Skip empty keys.
		if (!trimmedKey) {
			continue
		}

		// For duplicates, the last one wins.
		result[trimmedKey] = parseBodyParamValue(value)
	}

	return result
}

/**
 * Converts the stored object back into editable tuples, round-tripping
 * non-string values through JSON so they render the way they were typed.
 */
export const convertObjectToBodyParams = (params: Record<string, unknown> | undefined): [string, string][] =>
	Object.entries(params ?? {}).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)])
