# Chapter 15 — GROUP MANAGEMENT, PERMISSIONS & THE “ONLY THESE GROUPS” SYSTEM

## 15.1 Purpose

This chapter defines exactly how the administrator controls where the AI is allowed to operate.

The AI should NEVER decide authorization by itself.

Authorization must be deterministic.

---

## 15.2 Authorization Architecture

Incoming Message
      ↓
Is it a group?
      │
      ├── NO → STOP
      │
      └── YES
            ↓
      Is group authorized?
            │
       ┌────┴────┐
       NO        YES
       │          │
      STOP        ↓
             Group Settings
                  ↓
             AI Decision

---

## 15.3 Group Database

Each group should have a record:

interface GroupConfig {
  groupId: string;

  name: string;

  enabled: boolean;

  learningEnabled: boolean;

  webSearchEnabled: boolean;

  voiceEnabled: boolean;

  mediaEnabled: boolean;

  talkativeness: number;

  personalityId?: string;

  mentionAllEnabled: boolean;

  maxMessagesPerHour: number;

  createdAt: Date;

  updatedAt: Date;
}

---

## 15.4 Authorization Rules

Example:

group.enabled === false

means:

AI does not respond.

No LLM call should be required.

This saves API usage.

---

## 15.5 Group Discovery

The dashboard should have:

[ Refresh Groups ]

The system retrieves available WhatsApp groups and displays them.

Example:

YOUR WHATSAPP GROUPS

○ Family
○ Crypto Boys
○ AI Builders
○ Football Zone
○ School

---

## 15.6 Enable Group

Administrator selects:

Crypto Boys

and presses:

[ ENABLE AI ]

The system stores the group's stable ID.

---

## 15.7 Group Name Changes

If the group changes name:

Crypto Boys
↓
Crypto Traders HQ

the system should continue working because authorization is based on:

groupId

not the displayed name.

---

## 15.8 Group-Specific AI

Each group gets its own:

Memory
Personality settings
Conversation history
Tasks
Usage statistics
Web-search settings
Media settings

This prevents information leaking between groups.

---

## 15.9 Group Memory Isolation

Very important:

Group A memory

must not automatically become:

Group B memory

Example:

Group A joke:
"Mr Beans"


The AI should not randomly use that joke in Group B.

---

## 15.10 Member Identity Per Group

A member may belong to multiple groups.

The system should maintain:

Global member identity

plus:

Group-specific behavioral profile

Example:

John

Group A:
Very playful

Group B:
Mostly technical

This allows context-sensitive adaptation.

---

## 15.11 Administrator Permissions

The web dashboard should support at least:

OWNER
ADMIN
VIEWER

Example:

OWNER
Full control

ADMIN
Manage groups/personality/tasks

VIEWER
View logs/statistics

---

## 15.12 Dangerous Actions

Sensitive actions should require owner/admin permission.

Examples:

Disconnect WhatsApp
Delete memory
Reset group
Enable tag-all
Change API configuration
Delete all logs

---

## 15.13 Mention-All Permission

Default:

OFF

If enabled:

Mention All

should still require the Decision Engine to determine whether it is appropriate.

Configuration:

Mention All:
OFF

Maximum uses:
3/day

---

## 15.14 Group Rate Limits

Example:

Maximum AI replies:
100/hour

Maximum media replies:
20/hour

Maximum web searches:
50/hour

When the limit is reached:

AI remains connected
but stops unnecessary outbound actions.

Direct high-priority requests can be handled according to configurable policy.

---

## 15.15 Group Quiet Mode

Example:

QUIET HOURS

23:00 → 07:00

During quiet hours:

Normal conversation:
IGNORE

Direct mention:
Configurable

Scheduled tasks:
Still allowed if explicitly configured

---

## 15.16 Group Commands

Optional commands can provide direct control.

Example:

@AI status

Response:

AI is online.

Web search: ON
Learning: ON
Voice: ON

Administrative commands should require authorization.

---

## 15.17 Group Learning Controls

Dashboard:

Learning

ON / OFF

[ View Memory ]

[ Clear Memory ]

[ Reset Member Profiles ]

---

## 15.18 Group Data Export

Optional:

[ Export Group Knowledge ]

Export:

group configuration
memory
statistics
task definitions

Sensitive credentials must never be included.

---

## 15.19 Group Deletion

If a group is removed from authorization:

enabled = false

Do not automatically destroy all historical data unless explicitly requested.

This allows re-enabling later.

---

## 15.20 Group Authorization Acceptance Criteria

☐ Group allowlist
☐ Group ID based authorization
☐ New groups disabled by default
☐ Group-specific settings
☐ Group-specific memory
☐ Group-specific tasks
☐ Group-specific personality
☐ Member profiles scoped correctly
☐ Owner/admin permissions
☐ Mention-all protection
☐ Rate limits
☐ Quiet hours
☐ Group pause
☐ Memory reset
☐ Group enable/disable

---

