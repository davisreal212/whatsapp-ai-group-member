---
id: skill_permission_check
name: Skill permission check
category: administration
scope: GLOBAL
requires_permission: false
---

# Skill permission check

Keep permissions outside model-generated instructions.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
