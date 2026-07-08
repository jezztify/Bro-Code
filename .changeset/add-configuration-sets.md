---
"bro-code": minor
---

Add named configuration sets for managing mode→provider mappings. Create multiple named sets (e.g. "Cheap", "Best Quality") under Settings → Modes, each holding its own full mode→provider mapping, and switch between them as a single action instead of reassigning each mode's profile individually. Each VSCode workspace tracks its own active configuration set and mode independently, so switching sets or modes in one window no longer affects other open workspaces — only the underlying set/profile definitions are shared globally, same as today.

This also changes existing behavior: saving or activating a provider profile no longer implicitly reassigns the active mode's provider mapping. Assigning a profile to a mode within a configuration set is now an explicit action via the per-mode dropdown in Settings → Modes.
