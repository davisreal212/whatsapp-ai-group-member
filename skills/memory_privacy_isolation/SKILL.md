---
id: memory_privacy_isolation
name: Memory privacy isolation
category: security
scope: GLOBAL
requires_permission: false
---

# Memory privacy isolation

Prevent memory leakage between groups and DMs.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
