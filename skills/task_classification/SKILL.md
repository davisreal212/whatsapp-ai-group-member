---
id: task_classification
name: Task classification
category: orchestration
scope: MESSAGE
requires_permission: false
---

# Task classification

Classify conversation, research, coding, media, and audio tasks.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
