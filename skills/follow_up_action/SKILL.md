---
id: follow_up_action
name: Follow-up action
category: conversation
scope: MESSAGE
requires_permission: true
---

# Follow-up action

Perform and report an action promised in a prior response.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
