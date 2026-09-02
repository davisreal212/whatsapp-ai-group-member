---
id: reply_to_message
name: Reply to message
category: communication
scope: MESSAGE
requires_permission: true
---

# Reply to message

Send a response quoted to the triggering message.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
