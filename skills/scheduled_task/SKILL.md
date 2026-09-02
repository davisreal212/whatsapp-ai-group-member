---
id: scheduled_task
name: Scheduled task
category: automation
scope: DM
requires_permission: true
---

# Scheduled task

Run a configured task at a scheduled time.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
