---
id: generate_replies
name: Generate replies
category: writing
scope: MESSAGE
requires_permission: false
---

# Generate replies

Suggest natural replies.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
