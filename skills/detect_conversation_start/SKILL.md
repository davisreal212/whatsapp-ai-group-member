---
id: detect_conversation_start
name: Detect conversation start
category: conversation
scope: MESSAGE
requires_permission: false
---

# Detect conversation start

Recognize when a new topic or interaction begins.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
