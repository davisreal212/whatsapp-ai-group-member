# Chapter 13 — TASKS, REMINDERS, PRICE ALERTS & BACKGROUND AGENT

## 13.1 Purpose

This is where the bot stops being only a conversational AI and becomes an agent.

Example:

"AI once BTC hit 80k abeg let me know."

The bot must understand that this is a persistent instruction.

It should create a task.

---

## 13.2 Task Architecture

Conversation
     ↓
Intent Detection
     ↓
Task Extraction
     ↓
Task Validation
     ↓
Task Database
     ↓
Scheduler / Worker
     ↓
Condition Check
     ↓
Notification

---

## 13.3 Task Object

Example:

interface Task {
  id: string;
  groupId: string;
  creatorId: string;

  type:
    | "PRICE_ALERT"
    | "REMINDER"
    | "SCHEDULED_MESSAGE"
    | "MONITOR"
    | "CUSTOM";

  condition?: object;

  message?: string;

  status:
    | "ACTIVE"
    | "TRIGGERED"
    | "PAUSED"
    | "CANCELLED";

  createdAt: Date;
  triggerAt?: Date;
}

---

## 13.4 BTC Alert Example

User:

@AI once BTC hit 80k abeg let me know.

Extract:

Asset:
BTC

Condition:
price >= 80000 USD

Action:
Notify requester/group

Status:
ACTIVE

---

## 13.5 Clarification

If the request is ambiguous:

"Tell me when BTC gets high."

Do NOT create:

BTC >= some random value

Ask:

"What price should I alert you at?"

---

## 13.6 Price Data

Price alerts require a market-data source.

Architecture:

Price Provider
      ↓
Price Worker
      ↓
Active Alerts
      ↓
Compare Conditions

Do not depend on an LLM to determine whether a price condition has triggered.

The LLM can interpret the request.

A deterministic worker should evaluate the actual condition.

---

## 13.7 Example

Task:

BTC >= $80,000

Worker:

Current price = $79,600
↓
FALSE

Later:

Current price = $80,020
↓
TRUE
↓
Trigger alert

---

## 13.8 Prevent Duplicate Alerts

Once triggered:

ACTIVE
↓
TRIGGERED

Do not send the same alert every polling cycle.

For recurring alerts, explicitly configure:

ONE_TIME
RECURRING

---

## 13.9 Alert Message

Example:

"Abeg 😂 BTC don cross $80k."

The response should use the configured personality.

The underlying event must come from verified market data.

---

## 13.10 Reminder

Example:

"AI remind me tomorrow 8pm to call David."

Extract:

Type:
REMINDER

Date:
Tomorrow

Time:
20:00

Message:
Call David

If timezone is unknown, use the configured account/group timezone.

---

## 13.11 Scheduled Group Message

Example:

"Every Monday morning remind the group about the meeting."

Task:

Schedule:
Every Monday

Action:
Send message

Target:
Configured group

---

## 13.12 Group Task Permissions

Tasks can be:

PERSONAL
GROUP
ADMIN_ONLY

Example:

Personal reminder:
Only requester gets notification.

Group alert:
Send to configured group.

---

## 13.13 Task Ownership

Every task should record:

creatorId
groupId
createdAt

This makes it possible to determine who owns/can cancel it.

---

## 13.14 Cancel Task

User:

@AI cancel my BTC 80k alert.

System:

Find active task
↓
Verify ownership
↓
Cancel

Response:

"Done 👍 cancelled."

---

## 13.15 List Tasks

User:

@AI what alerts do I have?

Response:

Active alerts:

• BTC ≥ $80,000
• BTC ≤ $70,000

Reminders:

• Call David — tomorrow 8pm

---

## 13.16 Task Dashboard

Dashboard:

TASKS

ACTIVE

BTC ≥ $80,000
Owner: John
Created: Aug 29
Status: Active

REMINDER

Call David
Owner: John
Tomorrow 8:00 PM

Actions:

[Pause]
[Cancel]
[Edit]

---

## 13.17 Background Worker

The bot needs a background process.

Main Bot
   │
   ├── WhatsApp Worker
   ├── AI Worker
   ├── Research Worker
   ├── Media Worker
   └── Task Worker

The Task Worker periodically checks active tasks.

---

## 13.18 Do Not Use LLM for Scheduling Logic

Bad architecture:

Every minute:
Ask AI:
"Has BTC reached 80k?"

This wastes API calls.

Better:

Market API
 ↓
Deterministic comparison
 ↓
Trigger

The AI is used for:

Understanding
Extraction
Natural-language responses

Not simple mathematical comparisons.

---

## 13.19 Free-Tier Optimization

Because the system is designed around free/low-cost services:

Use event-driven processing where possible.

Cache data.

Batch compatible requests.

Use provider fallback.

Avoid unnecessary LLM calls.

Avoid polling extremely frequently unless necessary.

For volatile prices, the exact polling interval should be configurable based on the available market-data service.

---

## 13.20 Task Failure

If the market provider fails:

Price check
↓
Provider failure
↓
Retry
↓
Backup provider

If still unavailable:

Task remains ACTIVE

Do not mark it triggered.

---

## 13.21 Task Reliability

Every task should record:

lastCheckedAt
lastSuccessfulCheck
lastError
retryCount

Dashboard:

BTC Alert

Status:
ACTIVE

Last checked:
10 seconds ago

Data source:
Provider A

Health:
GOOD

---

## 13.22 Notification Routing

A task needs a destination.

Example:

notificationTarget:
GROUP

or:

notificationTarget:
USER

For a group task:

groupId = current group

For a private reminder:

chatId = creator's DM

---

## 13.23 Task Security

A member must not be able to modify somebody else's private task merely by saying:

"Cancel John's alert."

Ownership must be checked.

---

## 13.24 Task Rate Limits

Prevent abuse:

Maximum active tasks/member
Maximum alerts/group
Maximum checks/minute
Maximum notifications/day

---

## 13.25 Background Agent Example

GROUP

John:
@AI remind me tomorrow at 8pm to check the project.

AI:
Sharp 👍 I'll remind you tomorrow at 8.

DATABASE:
Task created.

NEXT DAY:

Scheduler
↓
Task due
↓
Notification
↓
AI sends message

---

## 13.26 Advanced Monitoring

The same architecture can eventually support:

BTC price alerts
ETH price alerts
Website monitoring
News monitoring
Event monitoring
Scheduled reminders
Recurring announcements
Custom conditions

Each monitor should have a specific provider/worker rather than forcing the LLM to perform every check.

---

## 13.27 Task Acceptance Criteria

☐ Natural-language task creation
☐ Reminder extraction
☐ Price-alert extraction
☐ Ambiguity clarification
☐ Task database
☐ Task ownership
☐ Group/private notification targets
☐ One-time tasks
☐ Recurring tasks
☐ Task cancellation
☐ Task editing
☐ Task listing
☐ Background worker
☐ Deterministic condition checking
☐ Price provider abstraction
☐ Provider fallback
☐ Retry system
☐ Failure logging
☐ Duplicate-trigger protection
☐ Dashboard task management
☐ Rate limits
☐ Timezone support

---

SYSTEM STATUS AFTER CHAPTER 13

At this point the architecture looks like:

                         WHATSAPP
                            │
                            ▼
                     MESSAGE RECEIVER
                            │
              ┌─────────────┼──────────────┐
              ▼             ▼              ▼
            TEXT          AUDIO          MEDIA
              │             │              │
              │             ▼              │
              │            STT              │
              │             │              │
              └─────────────┼──────────────┘
                            ▼
                    CONTEXT BUILDER
                            │
             ┌──────────────┼──────────────┐
             ▼              ▼              ▼
       GROUP MEMORY    MEMBER MEMORY   CHAT HISTORY
             │              │              │
             └──────────────┼──────────────┘
                            ▼
                     DECISION ENGINE
                            │
        ┌───────────────────┼──────────────────┐
        ▼                   ▼                  ▼
      IGNORE              REPLY              TASK
                            │                  │
                            ▼                  ▼
                      NEED SEARCH?        TASK WORKER
                            │                  │
                       ┌────┴────┐             │
                       ▼         ▼             ▼
                    SEARCH     NO SEARCH    CONDITIONS
                       │                        │
                       ▼                        ▼
                  TAVILY/FALLBACK           TRIGGER
                       │                        │
                       └──────────┬─────────────┘
                                  ▼
                         RESPONSE GENERATOR
                                  │
                           PERSONALITY
                                  │
                         RESPONSE VALIDATOR
                                  │
                           ACTION PLANNER
                                  │
              ┌───────────────────┼─────────────────┐
              ▼                   ▼                 ▼
             TEXT              AUDIO              MEDIA
              │                   │                 │
              └───────────────────┼─────────────────┘
                                  ▼
                              WHATSAPP

The next chapters should move into the actual WhatsApp connection layer, group-only authorization, dashboard controls, multi-AI provider routing (Gemini + Groq + OpenRouter), and the complete deployment architecture.