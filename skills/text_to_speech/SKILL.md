---
id: text_to_speech
name: Text to speech
category: voice
scope: MESSAGE
requires_permission: true
---

# Text to speech

Generate audio with an approved provider.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
