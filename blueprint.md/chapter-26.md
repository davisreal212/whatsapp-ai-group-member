# Chapter 26 — NATURAL REPLIES, REPLIES, REACTIONS & MENTIONS

## 26.1 Purpose

The bot should communicate naturally inside a WhatsApp group.

It should understand the difference between:

Normal message
Reply
Mention
Reaction
Media
Voice note

---

## 26.2 Reply-To-Message

If the bot decides to respond to a specific message, the outbound action should contain:

{
  action: "REPLY",
  targetMessageId: "..."
}

The WhatsApp adapter should use the platform/library's native reply mechanism where available.

---

## 26.3 Example

John:
Who dey awake?

AI:
Me 😂

The AI should reply directly to John's message when appropriate.

---

## 26.4 Reply Context

When receiving a message, retrieve:

current message
+
quoted/replied message
+
sender of quoted message
+
recent conversation

This prevents context errors.

---

## 26.5 Mention Detection

Detect:

@AI
@Phoenix
AI
bot

depending on the configured bot identity.

Direct mention should increase response priority.

---

## 26.6 Mentioning a Member

If the response naturally requires another member:

John:
Who knows the password?

AI:
@David probably knows.

The system should only tag David if the bot has sufficient reason to believe David is relevant.

---

## 26.7 Avoid Random Mentions

Never do:

@John @David @Peter @Mary

just to make the message look active.

Mentioning people should have a conversational reason.

---

## 26.8 Mention-All

The system may support:

@all

or the equivalent supported by the WhatsApp integration.

But this should be restricted.

Configuration:

mentionAllEnabled = false

by default.

If enabled:

maximum uses/hour
minimum importance
administrator permission
cooldown

should apply.

---

## 26.9 When Mention-All Makes Sense

Example:

AI:
@all Important update: the meeting time has changed to 7pm.

This is potentially useful.

Not:

AI:
@all 😂😂

---

## 26.10 Reactions

The AI should be able to choose a reaction where supported.

Examples:

😂
❤️
👍
😮
🔥

Reaction selection should depend on context.

---

## 26.11 Reaction Instead of Reply

Example:

John:
This guy is finished 😂😂

Possible action:

REACTION 😂

This is often more natural than sending text.

---

## 26.12 No Reaction Spam

The bot should have limits.

Example:

Maximum reactions:
configured per group

It should not react to every message.

---

## 26.13 Message Length

The AI should adapt response length.

Casual:

"😂😂 no way"

Simple factual:

"BTC is around $X right now."

Complex research:

Several short paragraphs.

---

## 26.14 Avoid Chatbot Language

Avoid unnecessary phrases such as:

"Certainly!"
"Of course!"
"Thank you for your question!"
"I'd be happy to assist."

unless the group context actually calls for that style.

---

## 26.15 Nigerian Conversational Style

If the group naturally uses Nigerian English/Pidgin, the AI can understand and occasionally use it.

Example:

"Abeg"
"Omo"
"Bro"
"Na so"
"Sharp"
"Guy"

But it should not force slang into every message.

---

## 26.16 Emoji Behavior

Emoji usage should depend on personality and context.

A playful personality:

😂😭🤣🔥

A serious answer:

Minimal emojis.

---

## 26.17 Personality Consistency

If dashboard personality is:

Calm

the bot should not suddenly become:

Extremely aggressive

because one group member used slang.

---

## 26.18 Conversational Memory

Example:

John:
I'm going to sleep.

AI:
Night 😂

30 minutes later:

John:
I'm back.

The AI can naturally recognize the continuation.

---

## 26.19 Human-Like Participation

The AI should sometimes:

React
Reply briefly
Ask a question
Continue a joke
Provide information
Stay silent

The important thing is variation based on context.

---

## 26.20 Chapter 26 Acceptance Criteria

☐ Native WhatsApp replies
☐ Reply-chain understanding
☐ Mention detection
☐ Member mentions
☐ Mention-all control
☐ Reactions
☐ Reaction selection
☐ Anti-reaction spam
☐ Dynamic response length
☐ Natural language
☐ Emoji adaptation
☐ Personality consistency
☐ Contextual participation
☐ Silence when appropriate

---

