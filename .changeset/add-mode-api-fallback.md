---
"bro-code": minor
---

Add per-mode API provider fallback — a mode can now fail over to an ordered list of backup provider profiles (`fallbackApiConfigIds`) when its primary provider keeps hitting transient errors (429/408, 5xx, or network failures). Fallbacks are tried once each, in order, after the primary profile's same-profile retries are exhausted (3 failed attempts); hard request-level errors (401/403/400/422) still fail loud without cycling through fallbacks. When a failover happens, Bro posts a chat message ("Bro is falling back from X to Y because of recent failed attempts.") and the active provider shown at the bottom of the chatbox switches to the fallback for the rest of the task (the mode's configured primary profile is left unchanged). Configure the chain per mode under Settings → Modes, including a configurable cap on how many fallbacks each mode may use.
