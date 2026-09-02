---
id: spotify_music_recommendation
name: Spotify music recommendation
category: media
scope: MESSAGE
requires_permission: false
---

# Spotify music recommendation

Recommend a song and provide a Spotify link.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
