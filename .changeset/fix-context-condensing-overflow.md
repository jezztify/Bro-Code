---
"bro-code": patch
---

Fix auto context condensing sometimes failing to prevent context window overflow. Condense results that still exceeded the token budget (e.g. an oversized summary) are now caught and further truncated automatically; recovering from a confirmed context-window-exceeded API error now always shrinks the conversation even if condensing itself fails; and the truncate-and-retry safety net now recognizes context-overflow errors from providers beyond OpenAI/OpenRouter/Anthropic.
