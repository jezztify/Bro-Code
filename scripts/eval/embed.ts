/**
 * Minimal embedding caller for the "similarity" metric (free-form text vs. reference).
 * Mirrors the shape of `IEmbedder.createEmbeddings` from
 * `src/services/code-index/embedders/interfaces/embedder.ts` (the abstraction the
 * codebase indexing feature uses) without importing it directly -- see callModel.ts
 * for why this harness avoids importing `src/` provider/embedder classes at runtime.
 */

export interface EmbedderSettings {
	apiKey?: string
	baseUrl?: string
	model?: string
}

export async function createEmbeddings(settings: EmbedderSettings, texts: string[]): Promise<number[][]> {
	const baseUrl = settings.baseUrl ?? "https://api.openai.com/v1"

	const response = await fetch(`${baseUrl}/embeddings`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${settings.apiKey ?? ""}`,
		},
		body: JSON.stringify({
			model: settings.model ?? "text-embedding-3-small",
			input: texts,
		}),
	})

	if (!response.ok) {
		throw new Error(`Embeddings request failed: ${response.status} ${await response.text()}`)
	}

	const data = (await response.json()) as { data?: Array<{ embedding: number[] }> }
	return (data.data ?? []).map((entry) => entry.embedding)
}
