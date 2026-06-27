# Requirements: `<NewProvider>` API Provider

**Goal:** Implement a new API provider, modeled exactly on the existing LM Studio provider, that talks to `<target LLM server>` over OpenAI-compatible chat completions, with provider-specific model discovery.

## 1. Settings schema (`packages/types/src/provider-settings.ts`)

Add a schema (pattern: `lmStudioSchema`) extending `baseProviderSettingsSchema` with these fields (rename `lmStudio*` → `<provider>*`):

- `<provider>ModelId?: string`
- `<provider>BaseUrl?: string` — defaults to `http://localhost:<port>` when empty
- `<provider>DraftModelId?: string` + `<provider>SpeculativeDecodingEnabled?: boolean` (omit if the target has no speculative decoding)
- `<provider>UseRestApi?: boolean` — toggles REST-only model discovery vs. a richer SDK/WebSocket path
- `<provider>BypassProxy?: boolean` + `<provider>ProxyUrl?: string` — proxy override controls
- `<provider>JsonToolCallFallbackEnabled?: boolean` — defaults to **enabled** (`!== false`), omit if the target reliably emits real `tool_calls`

## 2. Proxy/fetch helper (`src/api/providers/utils/<provider>-proxy.ts`)

Mirror `lmstudio-proxy.ts`:

- `get<Provider>FetchConfig(options, timeoutMs)` → builds an undici `Agent` or `ProxyAgent` (with `proxyTunnel: false` for non-TLS local servers) and, only when bypass/custom-proxy is set, returns a raw undici `fetch` to bypass VS Code's patched `globalThis.fetch`.
- `<provider>Fetch(url, proxyOptions, timeoutMs=10000)` — wraps fetch with an `AbortController` timeout, using the same dispatcher logic.
- `test<Provider>Connection(baseUrl, proxyOptions, timeoutMs)` → hits the server's model-list endpoint, returns `{ success, error?, modelCount? }`. On error, walk `error.cause` chain to produce an actionable message (`describeFetchError`).

**Why this exists:** undici defaults `headersTimeout`/`bodyTimeout` to 5 minutes, which can silently abort slow local-model requests before the user's configured timeout. Don't skip this — a naive `fetch()` will intermittently truncate long-running completions.

## 3. Model fetcher (`src/api/providers/fetchers/<provider>.ts`)

- `get<Provider>Models(baseUrl, useRestApi, proxyOptions) → Record<string, ModelInfo>`
    - If `useRestApi`: call a REST-only path with a fallback chain across the target's API versions (richest endpoint with context-length/capability metadata first, generic OpenAI-compatible `/v1/models` last as universal fallback). Each parser fills `ModelInfo` defaults via `Object.assign({}, <provider>DefaultModelInfo, {...})`.
    - If not REST-only and the target has a richer SDK: connect, list downloaded models, list currently-loaded models (loaded wins on conflicts — dedupe by checking if a loaded model's key is a path segment of a downloaded entry), and fall back to the OpenAI-compatible REST response if the SDK calls fail entirely (this is the common case for remote instances).
    - On connection-refused, `console.warn`; on other errors, `console.error` with full serialized error. Never throw — return whatever was collected (possibly empty).
- Optional: `get<Provider>EmbeddingModels(...)` if the target distinguishes embedding vs. chat models — same fallback chain, filtering by model type instead of building full `ModelInfo`.
- Track which model IDs have "full details loaded" (a `Set<string>`) if the target has a notion of partial vs. full metadata only available after first connecting to a loaded model.

## 4. The handler (`src/api/providers/<provider>.ts`)

Class `<Provider>Handler extends BaseProvider implements SingleCompletionHandler`:

- Constructor: build an `OpenAI` client with `baseURL = (options.<provider>BaseUrl || default) + "/v1"`, placeholder API key (`"noop"` if the target needs none), `timeout: this.timeoutMs`, and `fetchOptions: { dispatcher }` from step 2, conditionally overriding `fetch` only when bypass/proxy is active.
- `getModel()`: look up `options.<provider>ModelId` in `getModelsFromCache("<provider>")`; fall back to `{ id: modelId || "", info: openAiModelInfoSaneDefaults }` if not cached.
- `createMessage(systemPrompt, messages, metadata)` (async generator, `ApiStream`):
    1. Build OpenAI-format messages via `convertToOpenAiMessages`.
    2. Count input tokens via `this.countTokens(...)` — catch and log failures, don't throw (defaults to 0).
    3. Call `client.chat.completions.create({ model, messages, temperature: options.modelTemperature ?? <PROVIDER>_DEFAULT_TEMPERATURE, stream: true, tools, tool_choice, parallel_tool_calls })`, plus draft-model param if speculative decoding applies. Wrap creation errors with `handleOpenAIError(error, providerName)`.
    4. Pipe `delta.content` through a `TagMatcher("think", ...)` to split `<think>` blocks into `reasoning` vs `text` chunks.
    5. **JSON tool-call fallback** (only if the target model is known to sometimes emit bare-JSON tool calls as plain text instead of real `tool_calls`): buffer text chunks that start with `{`/`<`, use `NativeToolCallParser.getBufferStatus`/`detectToolCallAttempt` (scoped only to `metadata.tools` filtered by `metadata.allowedFunctionNames`) to detect a real tool-call shape once balanced, emit a synthetic `tool_call` chunk if matched, otherwise flush as plain text. Disable entirely once a real `delta.tool_calls` has been seen in the stream (`sawRealToolCall`), and flush any pending buffer as text when that happens.
    6. Emit `tool_call_partial` per streamed `delta.tool_calls[]` entry, and run `NativeToolCallParser.processFinishReason(finishReason)` to emit `tool_call_end` events.
    7. After the stream and `matcher.final()`, flush any leftover buffered candidate as text, count output tokens (catch/log, default 0), and yield a final `{ type: "usage", inputTokens, outputTokens }`.
    8. Any top-level failure → rethrow as `Error("<Provider> request failed: ${reason}\nPlease check ... You may need to load the model with a larger context length...")`.
- `completePrompt(prompt)`: non-streaming single-turn call, same temperature/draft-model logic, returns `response.choices[0]?.message.content || ""`, same error wrapping.
- Export a standalone `get<Provider>Models(baseUrl)` convenience function used elsewhere for simple model-name listing via axios GET to `/v1/models`, swallowing all errors to `[]`.

## 5. Wiring

- Register the new handler in `src/api/providers/index.ts`.
- Add the provider's enum/key to wherever provider settings are read (`src/shared/api.ts` around the `lmstudio: {}` entry).
- Add IPC/message types in `packages/types/src/vscode-extension-host.ts` (pattern: `lmStudioModels`, `lmStudioConnectionTestResult`) for the webview to request model lists / connection tests.
- Add the settings UI panel (model ID, base URL, REST-API toggle, proxy fields, speculative decoding fields if applicable).

## 6. Tests to replicate (pattern, not literal content)

- `__tests__/<provider>.spec.ts` — streaming, non-streaming, error wrapping, draft-model param inclusion.
- `__tests__/<provider>-native-tools.spec.ts` — real `tool_calls` streaming + the JSON-fallback heuristic (both detection and the "stop fallback once a real tool call is seen" behavior).
- `__tests__/<provider>-timeout.spec.ts` — verifies the undici dispatcher timeout actually overrides the 5-minute default.
- `fetchers/__tests__/<provider>.test.ts` — each parser/fallback-chain branch, dedupe logic between loaded/downloaded models, connection-refused handling.

## Explicit non-goals / things NOT to change

- Don't touch `src/api/providers/lm-studio.ts` or its sibling files — this is a net-new parallel provider.
- Don't redesign `BaseProvider` / `SingleCompletionHandler` / `ApiStream` interfaces — match them as-is.
- Skip the speculative-decoding and JSON-tool-call-fallback sections entirely if the target system has no equivalent need (don't invent config for nonexistent features).
