---
id: error_diagnosis
name: Error diagnosis
category: developer
scope: MESSAGE
requires_permission: false
---

# Error diagnosis

Identify likely causes of errors.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
