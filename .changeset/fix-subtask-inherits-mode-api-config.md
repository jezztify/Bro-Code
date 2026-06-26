---
"bro-code": patch
---

Fix subtasks created during orchestration (mode delegation) ignoring the API configuration assigned to their mode in settings — they now load the mode's own provider profile instead of inheriting the parent task's
