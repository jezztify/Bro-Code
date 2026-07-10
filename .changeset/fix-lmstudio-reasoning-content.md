---
"bro-code": patch
---

Fix LM Studio reasoning/thinking not rendering as a collapsible reasoning block. The LM Studio
provider only detected reasoning wrapped in inline `<think>`/`<thought>` tags; models that instead
emit a structured `reasoning`/`reasoning_content` delta field (as native reasoning-capable models
served through LM Studio commonly do) had their thinking shown as plain assistant text. LM Studio
now checks both formats, matching every other OpenAI-compatible provider in Bro Code.
