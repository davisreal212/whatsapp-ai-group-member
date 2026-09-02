---
id: group_skill_permissions
name: Group skill permissions
category: administration
scope: GROUP
requires_permission: true
---

# Group skill permissions

Configure skills per group.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
