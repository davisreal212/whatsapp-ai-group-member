---
id: speech_to_text
name: Speech to text
category: audio
scope: MESSAGE
requires_permission: true
---

# Speech to text

Transcribe an incoming voice note.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
