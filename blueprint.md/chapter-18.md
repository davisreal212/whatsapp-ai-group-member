# Chapter 18 — DATABASE SCHEMA & LONG-TERM MEMORY

## 18.1 Purpose

This is one of the most important chapters.

The AI must not simply "read the last 20 messages."

It needs structured memory.

The architecture should remember:

Group
Members
Conversation
Important events
Member behavior
Topics
Inside jokes
Preferences
Tasks
Search history
Decisions

---

## 18.2 Core Database

A relational database such as PostgreSQL is suitable.

Recommended major tables:

users
whatsapp_sessions
groups
group_members
messages
media
member_profiles
group_memory
conversation_summaries
tasks
searches
ai_requests
provider_usage
system_events

---

## 18.3 Users

Dashboard administrators:

users

Example:

id
email
password_hash
role
created_at
updated_at

Never store plain-text passwords.

---

## 18.4 WhatsApp Sessions

whatsapp_sessions

id
account_id
status
phone_number_masked
session_reference
last_connected_at
last_seen_at
created_at
updated_at

The actual authentication material should be stored securely.

---

## 18.5 Groups

groups

id
whatsapp_group_id
name
enabled
learning_enabled
search_enabled
voice_enabled
media_enabled
talkativeness
personality_id
timezone
created_at
updated_at

---

## 18.6 Group Members

group_members

id
group_id
whatsapp_user_id
display_name
first_seen_at
last_seen_at
message_count
is_admin
is_active

---

## 18.7 Messages

messages

id
whatsapp_message_id
group_id
sender_id
message_type
text
quoted_message_id
timestamp
processed
processing_status
created_at

Do not store enormous amounts of raw media directly in this table.

---

## 18.8 Media

media

id
message_id
type
mime_type
file_size
storage_reference
duration
transcription
created_at
expires_at

Temporary media can automatically expire.

---

## 18.9 Member Profiles

This table represents the AI's understanding of a member.

member_profiles

id
group_member_id
communication_style
common_topics
humor_style
language_style
interaction_patterns
confidence
last_updated

---

## 18.10 Important Rule

The AI must distinguish:

FACT
OBSERVATION
INFERENCE
GUESS

Never save:

"John is definitely rich."

just because John once said:

"I bought a new car."

Instead:

Observation:
John mentioned purchasing a new car.

Confidence:
0.76

---

## 18.11 Group Memory

group_memory

id
group_id
memory_type
content
source_message_id
importance
confidence
created_at
last_used_at

Memory types:

FACT
INSIDE_JOKE
GROUP_EVENT
PREFERENCE
TOPIC
RULE
PERSON
PROJECT
OTHER

---

## 18.12 Memory Importance

Not every message should become memory.

Score:

0–20:
Temporary

21–50:
Low importance

51–80:
Useful

81–100:
Important

Only sufficiently valuable information should become long-term memory.

---

## 18.13 Example

Conversation:

John:
Our meeting is Friday 7pm.

David:
Yes.

Memory extraction:

Group Event:
Meeting Friday 7pm

Importance:
85

Confidence:
0.97

---

## 18.14 Conversation Summaries

Long conversations should periodically become summaries.

Example:

conversation_summaries

group_id
period_start
period_end
summary
topics
participants
created_at

Instead of loading 10,000 messages every time:

Recent messages
+
Relevant memories
+
Conversation summaries

---

## 18.15 Semantic Memory

For advanced retrieval, store embeddings for memory records.

Architecture:

Memory
 ↓
Embedding
 ↓
Vector Storage

When a new message arrives:

Message
 ↓
Embedding
 ↓
Similarity Search
 ↓
Relevant memories

This is how the AI can remember something discussed weeks ago without loading the entire chat.

---

## 18.16 Memory Retrieval

Example:

Current:

"That thing we talked about last week 😂"

System:

Current message
 ↓
Semantic retrieval
 ↓
Relevant memories
 ↓
Conversation summary
 ↓
AI context

The AI can determine what "that thing" likely refers to.

---

## 18.17 Member Personality Learning

This is NOT psychological diagnosis.

The system should learn conversational behavior only.

Examples:

John:
Frequently jokes.

Mary:
Usually asks technical questions.

David:
Often sends voice notes.

Peter:
Mostly reacts with emojis.

These are behavioral observations from the group conversation.

---

## 18.18 Confidence Updates

If John repeatedly jokes:

Observation 1:
humor = likely

Observation 2:
humor = likely

Observation 3:
humor = likely

Confidence increases gradually.

If behavior changes:

John becomes more formal.

the profile should adapt.

---

## 18.19 Memory Decay

Old information should not remain equally important forever.

Example:

last_used_at

can influence retrieval priority.

Temporary information can expire.

Permanent information should remain longer.

---

## 18.20 Contradictions

If memory says:

John prefers Android.

Later:

John:
I switched to iPhone.

Do not retain both as equally current.

Update:

Old:
John prefers Android

New:
John currently uses iPhone

Status:
UPDATED

---

## 18.21 Memory Correction

If a user says:

"AI that's not correct."

the system should be able to mark the memory as:

DISPUTED

and avoid using it until resolved.

---

## 18.22 Memory Isolation

Critical rule:

Group A memories
≠
Group B memories

unless the information is intentionally global and permitted.

---

## 18.23 Database Indexes

Important indexes:

messages(group_id, timestamp)

messages(sender_id, timestamp)

messages(whatsapp_message_id)

group_memory(group_id, importance)

group_members(group_id, whatsapp_user_id)

tasks(group_id, status)

This keeps retrieval fast.

---

## 18.24 Retention

The dashboard should allow:

Message retention:
7 days
30 days
90 days
Custom

Memory retention:
Long-term

Media retention:
24 hours
7 days
Custom

Do not retain everything forever by default.

---

## 18.25 Database Backup

The database should have automated backups.

At minimum:

Daily backup

and preferably multiple recovery points depending on infrastructure.

---

## 18.26 Chapter 18 Acceptance Criteria

☐ PostgreSQL-compatible schema
☐ Group isolation
☐ Member profiles
☐ Message storage
☐ Media metadata
☐ Group memory
☐ Conversation summaries
☐ Semantic retrieval
☐ Memory confidence
☐ Memory importance
☐ Memory correction
☐ Contradiction handling
☐ Memory decay
☐ Retention settings
☐ Database indexes
☐ Automated backups

---

