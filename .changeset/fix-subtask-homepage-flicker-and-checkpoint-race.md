---
"zoo-code": patch
---

Fix newly delegated subtasks briefly bouncing back to the homepage/welcome view before their chat view appears — the webview is now optimistically told the child task is current right after it's created, instead of waiting on the (slower) parent delegation metadata write. Fix a task appearing stuck when a checkpoint is created while auto-approve is disabled for Questions: checkpoint creation now awaits posting the "checkpoint saved" chat message before returning control to the tool loop, so it can no longer land after and visually bury a pending follow-up question.
