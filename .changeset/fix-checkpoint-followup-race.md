---
"bro-code": patch
---

Fix task appearing stuck after a checkpoint is created when auto-approve is disabled for Questions. The checkpoint's `checkpoint_saved` chat message was posted fire-and-forget, so it could land in the webview after a subsequent follow-up question ask, making the pending question appear to be overtaken and hidden by the checkpoint row. `checkpointSave` now awaits the checkpoint message before returning, preserving correct message ordering.
