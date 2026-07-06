---
"bro-code": patch
---

Fix browsing provider profiles in Settings immediately activating them — selecting a different profile in the Providers tab dropdown now only loads its settings into the form for editing/preview; the mode's provider mapping, global state, and any running task's API handler are no longer touched until you click Save
