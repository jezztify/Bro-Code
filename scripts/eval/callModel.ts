/**
 * Minimal, dependency-free model callers for the eval harness.
 *
 * Why this doesn't reuse `src/api/providers/*` handler classes directly: those
 * transitively require `@roo-code/telemetry` (which requires `vscode`) and other
 * dependencies that assume the esbuild-bundled extension-host runtime. Re-creating
 * that bundling step just to run a headless script isn't worth the fragility, so
 * this module talks to the same provider HTTP APIs directly instead, using the same
 * systemPrompt + single-user-message shape the product's handlers use, so scores
 * stay representative of real model behavior. Settings field names match this
 * repo's `ProviderSettings` (see packages/types/src/provider-settings.ts) for the
 * three providers supported here.
 */

export interface ModelSettings {
	apiProvider: "anthropic" | "openai" | "ollama"
	// anthropic
	apiKey?: string
	apiModelId?: string
	anthropicBaseUrl?: string
	// openai (OpenAI-compatible endpoint)
	openAiApiKey?: string
	openAiModelId?: string
	openAiBaseUrl?: string
	// ollama
	ollamaApiKey?: string
	ollamaModelId?: string
	ollamaBaseUrl?: string
}

export async function callModel(settings: ModelSettings, systemPrompt: string, userPrompt: string): Promise<string> {
	switch (settings.apiProvider) {
		case "anthropic":
			return callAnthropic(settings, systemPrompt, userPrompt)
		case "openai":
			return callOpenAiCompatible(settings, systemPrompt, userPrompt)
		case "ollama":
			return callOllama(settings, systemPrompt, userPrompt)
		default:
			throw new Error(`Unsupported apiProvider "${settings.apiProvider}" in eval harness`)
	}
}

async function callAnthropic(settings: ModelSettings, systemPrompt: string, userPrompt: string): Promise<string> {
	const baseUrl = settings.anthropicBaseUrl ?? "https://api.anthropic.com"

	const response = await fetch(`${baseUrl}/v1/messages`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-api-key": settings.apiKey ?? "",
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify({
			model: settings.apiModelId ?? "claude-3-5-haiku-20241022",
			max_tokens: 1024,
			system: systemPrompt,
			messages: [{ role: "user", content: userPrompt }],
		}),
	})

	if (!response.ok) {
		throw new Error(`Anthropic request failed: ${response.status} ${await response.text()}`)
	}

	const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> }
	return (data.content ?? [])
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("")
}

async function callOpenAiCompatible(
	settings: ModelSettings,
	systemPrompt: string,
	userPrompt: string,
): Promise<string> {
	const baseUrl = settings.openAiBaseUrl ?? "https://api.openai.com/v1"

	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${settings.openAiApiKey ?? ""}`,
		},
		body: JSON.stringify({
			model: settings.openAiModelId ?? "gpt-4o-mini",
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
		}),
	})

	if (!response.ok) {
		throw new Error(`OpenAI-compatible request failed: ${response.status} ${await response.text()}`)
	}

	const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
	return data.choices?.[0]?.message?.content ?? ""
}

async function callOllama(settings: ModelSettings, systemPrompt: string, userPrompt: string): Promise<string> {
	const baseUrl = settings.ollamaBaseUrl ?? "http://localhost:11434"

	const headers: Record<string, string> = { "content-type": "application/json" }
	if (settings.ollamaApiKey) {
		headers.authorization = `Bearer ${settings.ollamaApiKey}`
	}

	const response = await fetch(`${baseUrl}/api/chat`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: settings.ollamaModelId ?? "llama3.1",
			stream: false,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
		}),
	})

	if (!response.ok) {
		throw new Error(`Ollama request failed: ${response.status} ${await response.text()}`)
	}

	const data = (await response.json()) as { message?: { content?: string } }
	return data.message?.content ?? ""
}
