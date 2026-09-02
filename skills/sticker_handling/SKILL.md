---
id: sticker_handling
name: Sticker handling
category: media
scope: MESSAGE
requires_permission: true
---

# Sticker handling

Process or send stickers where supported.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
