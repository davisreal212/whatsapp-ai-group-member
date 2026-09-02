---
id: conditional_action
name: Conditional action
category: automation
scope: MESSAGE
requires_permission: true
---

# Conditional action

Execute an action only when conditions are satisfied.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
