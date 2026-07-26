---
"zoo-code": patch
---

Fix browsing provider profiles in Settings → Providers immediately activating them and saving edits reassigning the active mode's profile. Selecting a different profile in the dropdown now only loads it into the form for editing/preview; the mode's provider mapping, global state, and any running task's API handler are untouched until Save. Save now only activates the profile (and updates the active mode's mapping) when saving the profile that's already active — saving edits to a different, merely-browsed profile just persists its settings.
