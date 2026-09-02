---
id: ai_provider_configuration
name: AI provider configuration
category: administration
scope: GLOBAL
requires_permission: true
---

# AI provider configuration

Configure providers and fallback order.

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
