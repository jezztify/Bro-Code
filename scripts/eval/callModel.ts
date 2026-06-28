/**
 * Minimal, dependency-free model callers for the eval harness.
 *
 * Why not reuse `src/api/providers/*` handler classes directly: they transitively
 * require `@bro-code/telemetry`, which requires `vscode`, and several of their other
 * transitive dependencies (e.g. through the OpenAI/execa toolchain) ship package.json
 * `exports` maps that only resolve correctly once esbuild-bundled the way the extension
 * itself is built. Re-creating that bundling step just to run a headless eval script
 * isn't worth the fragility. This module talks to the same provider HTTP APIs directly
 * instead, with the same shape of inputs (systemPrompt + a single user message) the
 * product's handlers use, so scores are representative of real model behavior.
 */

export interface ModelSettings {
	apiProvider: "anthropic" | "openai" | "ollama"
	apiKey?: string
	apiModelId?: string
	baseUrl?: string
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
	const response = await fetch("https://api.anthropic.com/v1/messages", {
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
	const baseUrl = settings.baseUrl ?? "https://api.openai.com/v1"

	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${settings.apiKey ?? ""}`,
		},
		body: JSON.stringify({
			model: settings.apiModelId ?? "gpt-4o-mini",
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
	const baseUrl = settings.baseUrl ?? "http://localhost:11434"

	const response = await fetch(`${baseUrl}/api/chat`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			model: settings.apiModelId ?? "llama3.1",
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
