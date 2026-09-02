---
id: recurring_task
name: Recurring task
category: automation
scope: DM
requires_permission: true
---

# Recurring task

Repeat a task according to configuration.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
