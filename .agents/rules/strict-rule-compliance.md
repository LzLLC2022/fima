---
description: Always check and strictly follow local rules before starting or concluding tasks
trigger: always_on
---

# Strict Adherence to Workspace Rules

1. **Mandatory Rule Check:** At the very beginning of any task or when entering a new workspace, you MUST proactively read and review all markdown files located in the `.agents/rules/` directory using the appropriate file viewing tools.
2. **Zero Omission:** All rules specified in the `.agents/rules/` directory (such as Git commit/push guidelines, encoding requirements, etc.) are strictly mandatory. You must execute all required procedures without waiting for explicit user prompts.
3. **Pre-Completion Verification:** Before concluding your turn and reporting task completion to the user, pause and verify that you have executed all automated steps mandated by the local rules (e.g., automatically committing and pushing to GitHub).

Failure to follow these rules is a critical error. Always verify your compliance before finishing your task.

