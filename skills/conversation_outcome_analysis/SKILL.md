---
id: conversation_outcome_analysis
name: Conversation outcome analysis
category: learning
scope: MESSAGE
requires_permission: false
---

# Conversation outcome analysis

Determine whether a response helped.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
