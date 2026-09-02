---
id: skill_observability
name: Skill observability
category: monitoring
scope: GLOBAL
requires_permission: false
---

# Skill observability

Record skill status and latency without logging message contents.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
