---
"bro-code": patch
---

Fix saving a provider's settings in the Settings → Providers tab reassigning the currently active mode's provider profile if you had browsed to a different (non-active) profile first. Save now only activates the profile and updates the mode's mapping when you're saving the profile that's already active; saving any other profile just persists its settings without touching the active mode's configuration.
