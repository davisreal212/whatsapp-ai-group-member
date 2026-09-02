---
id: multi_tool_planning
name: Multi-tool planning
category: orchestration
scope: MESSAGE
requires_permission: false
---

# Multi-tool planning

Plan several approved skills in sequence.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
