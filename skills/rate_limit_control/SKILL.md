---
id: rate_limit_control
name: Rate-limit control
category: administration
scope: GLOBAL
requires_permission: true
---

# Rate-limit control

Control skill usage.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
