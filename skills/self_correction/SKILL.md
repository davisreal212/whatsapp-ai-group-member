---
id: self_correction
name: Self-correction
category: human_behavior
scope: MESSAGE
requires_permission: false
---

# Self-correction

Recognize and correct the bot's own mistakes.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
