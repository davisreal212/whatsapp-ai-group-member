# Chapter 19 — BACKGROUND WORKERS, QUEUES & REAL-TIME PROCESSING

## 19.1 Purpose

The system cannot perform everything inside one HTTP request.

It needs workers.

Architecture:

                    APPLICATION
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
       API SERVER    WHATSAPP       DASHBOARD
                        │
                        ▼
                      QUEUE
                        │
        ┌───────────────┼────────────────┐
        ▼               ▼                ▼
   AI WORKER       MEDIA WORKER      TASK WORKER

---

## 19.2 Why Queues?

Suppose 20 people send messages at once.

Without a queue:

20 messages
 ↓
20 simultaneous AI operations
 ↓
Provider overload

With a queue:

20 messages
 ↓
Queue
 ↓
Controlled processing

---

## 19.3 Message Queue

Example jobs:

PROCESS_MESSAGE
TRANSCRIBE_AUDIO
ANALYZE_IMAGE
SEARCH_WEB
GENERATE_RESPONSE
SEND_MESSAGE
CREATE_MEMORY
RUN_TASK

---

## 19.4 Job Structure

interface Job {
  id: string;

  type: string;

  payload: object;

  priority: number;

  attempts: number;

  status: string;

  createdAt: Date;

  startedAt?: Date;

  completedAt?: Date;
}

---

## 19.5 Priority

Not every job is equally important.

Example:

Priority 10:
Direct user request

Priority 8:
Voice transcription

Priority 5:
Memory extraction

Priority 3:
Analytics

This keeps important interactions responsive.

---

## 19.6 Group Message Ordering

Messages from the same group should generally preserve conversational order.

Example:

Message 101
Message 102
Message 103

Avoid replying to 103 before processing 101 when context depends on the earlier messages.

---

## 19.7 Debouncing

If several messages arrive rapidly:

John:
Bro

John:
Check this

John:
😂😂

the system can wait briefly and process them together.

Example:

300–1500 ms

configured by the application.

This makes the AI more natural.

---

## 19.8 AI Processing Pipeline

MESSAGE
 ↓
AUTHORIZATION
 ↓
QUEUE
 ↓
CONTEXT RETRIEVAL
 ↓
DECISION
 ↓
SEARCH IF NEEDED
 ↓
RESPONSE GENERATION
 ↓
VALIDATION
 ↓
OUTBOUND QUEUE
 ↓
WHATSAPP

---

## 19.9 Search Worker

Web searches should have their own worker.

AI:
Need current information

 ↓

SEARCH JOB

 ↓

Tavily

 ↓

Source extraction

 ↓

Research synthesis

---

## 19.10 Search Failure

If primary search fails:

Tavily
 ↓
Failure
 ↓
Fallback search provider
 ↓
Success

If no reliable result exists:

AI should say it could not verify the information.

It must not fabricate a source.

---

## 19.11 Media Worker

Media jobs:

DOWNLOAD_MEDIA
TRANSCRIBE_AUDIO
ANALYZE_IMAGE
GENERATE_AUDIO
DOWNLOAD_MEME
UPLOAD_MEDIA

These should be independently queued.

---

## 19.12 Task Worker

Runs scheduled operations:

REMINDER
PRICE_ALERT
MONITOR
SCHEDULED_MESSAGE

The worker checks active tasks.

---

## 19.13 Scheduled Jobs

Example:

Every minute:
Check due reminders.

Every configured interval:
Check active price monitors.

Every hour:
Run maintenance.

Every day:
Create backups/cleanup.

---

## 19.14 Memory Worker

Memory processing should happen asynchronously.

Conversation:

User message
 ↓
AI response
 ↓
Immediate conversation complete

Then:

Memory Worker
 ↓
Analyze conversation
 ↓
Extract important information
 ↓
Update memory

This avoids slowing normal replies.

---

## 19.15 Retry Queue

Failed jobs can enter:

RETRY

Example:

Attempt 1
 ↓
Failure

Attempt 2
 ↓
Failure

Attempt 3
 ↓
Dead Letter Queue

---

## 19.16 Dead Letter Queue

Jobs that repeatedly fail should not be retried forever.

Store:

jobId
error
attempts
payload reference
failedAt

Dashboard:

FAILED JOBS: 4

[View]

---

## 19.17 Real-Time Dashboard

The dashboard should update without manual refresh.

Examples:

WhatsApp connected
Message received
AI processing
AI response sent
Provider failure
Task triggered

Use an appropriate real-time mechanism such as WebSockets or server-sent events.

---

## 19.18 Worker Health

Dashboard:

WORKERS

WhatsApp Worker     ● Healthy
AI Worker           ● Healthy
Search Worker       ● Healthy
Media Worker        ● Healthy
Task Worker         ● Healthy
Memory Worker       ● Healthy

---

## 19.19 Queue Health

Display:

Pending:
12

Processing:
3

Failed:
1

Average latency:
## 1.8 sec

---

## 19.20 Graceful Shutdown

When deploying a new version:

STOP ACCEPTING NEW JOBS
        ↓
FINISH ACTIVE JOBS
        ↓
CLOSE CONNECTIONS
        ↓
DEPLOY
        ↓
START WORKERS

This prevents lost messages.

---

## 19.21 Idempotency

Important outbound actions should have unique identifiers.

If the system crashes after sending:

"Hello 😂"

but before recording success, it must avoid sending the same message twice after restart.

Use:

idempotency_key

for outbound operations where supported.

---

## 19.22 Chapter 19 Acceptance Criteria

☐ Message queue
☐ AI worker
☐ Search worker
☐ Media worker
☐ Task worker
☐ Memory worker
☐ Priority system
☐ Retry system
☐ Dead-letter queue
☐ Message ordering
☐ Debouncing
☐ Real-time dashboard updates
☐ Worker health monitoring
☐ Queue monitoring
☐ Graceful shutdown
☐ Idempotent outbound actions

---

