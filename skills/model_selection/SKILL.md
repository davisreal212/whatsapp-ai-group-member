---
id: model_selection
name: Model selection
category: orchestration
scope: GLOBAL
requires_permission: false
---

# Model selection

Choose an appropriate configured AI provider.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
