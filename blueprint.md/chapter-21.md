# Chapter 21 — THE HUMAN-LIKE DECISION ENGINE

## 21.1 Purpose

The Decision Engine is the most important component between receiving a WhatsApp message and generating a response.

The AI must NOT behave like:

Every message
     ↓
AI responds

Instead:

Message
   ↓
Understand context
   ↓
Determine relevance
   ↓
Determine social intent
   ↓
Determine whether intervention is useful
   ↓
Choose action

Possible actions:

IGNORE
REPLY
REPLY_TO_MESSAGE
REACT
MENTION_USER
MENTION_MULTIPLE_USERS
MENTION_ALL
SEARCH
SEND_MEDIA
SEND_AUDIO
CREATE_TASK
ASK_CLARIFICATION

---

## 21.2 The Bot Must Be Comfortable With Silence

A major requirement is:

«The AI should not feel obligated to respond.»

For example:

John:
Good morning guys

David:
Morning

Peter:
Morning 😂

The AI can simply remain silent.

It does not need:

AI:
Good morning everyone!

unless there is a reason to participate.

---

## 21.3 Direct Mention Has Higher Priority

Example:

John:
@AI what do you think?

This is a strong signal that the user wants a response.

Decision:

DIRECT_MENTION
      ↓
High response priority

But even direct mentions can require clarification or refusal depending on the request.

---

## 21.4 Reply-To-AI

If someone replies directly to the AI's previous message:

John:
[Reply to AI]
"Exactly 😂"

the AI should understand that the message is directed toward it.

This is different from an ordinary group message.

---

## 21.5 Reply-To-User

If someone says:

John:
[Reply to David]
"You're lying bro 😂"

the AI should understand that John is primarily talking to David.

It should not automatically interrupt.

---

## 21.6 Conversation Flow Detection

The AI should recognize:

John:
BTC is moving

David:
Yeah

Peter:
Maybe dump incoming

John:
Nah


The AI should understand that this is an ongoing human conversation.

If it has nothing useful to contribute:

IGNORE

---

## 21.7 Social Relevance Score

Create a score:

relevanceScore = 0–100

Possible factors:

Direct mention          +40
Reply to AI             +35
AI's current topic      +20
AI-known group topic    +10
Question requiring AI   +30
Casual conversation     +5
Completely unrelated    -30

These are examples, not fixed values.

The weights should be configurable and eventually learn from real interaction patterns.

---

## 21.8 Response Probability

The final decision should combine:

Relevance
+
Conversation context
+
Personality
+
Group culture
+
Talkativeness
+
Recent AI activity
+
Message intent
+
Whether another person already answered

Example:

Score:
82

Decision:
REPLY

Another:

Score:
18

Decision:
IGNORE

---

## 21.9 Avoid Answering Questions Already Answered

Example:

John:
What time is the match?

David:
8pm.

AI:
The match is 8pm.

This feels unnecessary.

The AI should detect:

Question already answered.

and stay silent.

---

## 21.10 When AI Should Add Value

The bot should prefer participating when it can:

Answer something unanswered
Provide useful information
Correct an important misconception
Continue a conversation naturally
Make a relevant joke
Provide requested media
Perform a requested search
Complete a task
Clarify something

---

## 21.11 Humor

If the group is joking:

John:
This guy can never cook 😂

David:
Leave me abeg

The AI may react:

😂

rather than giving an essay.

---

## 21.12 Reaction vs Text

The decision engine should select the smallest useful response.

Example:

Message:
"Bro 😂😂😂"

Possible action:
REACTION 😂

not:

"HAHAHAHA that is very funny..."

---

## 21.13 Human-Like Timing

Responses should have configurable timing.

Example:

Simple reaction:
1–3 sec

Short text:
2–8 sec

Research:
After search completes

Long reasoning:
Longer

The purpose is natural interaction, not pretending to be a specific human.

---

## 21.14 Do Not Fake Typing Forever

Avoid artificially long delays.

If the system takes 10 seconds because it is performing web research, that is fine.

But do not create unnecessary delays simply to imitate human typing.

---

## 21.15 Conversation Interruption

The AI should avoid interrupting conversations.

Example:

John:
Bro you remember that place?

David:
Which one?

John:
The one near Ikeja

David:
Oh yes 😂

AI should usually remain silent.

---

## 21.16 Topic Opportunity

The AI can identify opportunities:

Topic:
Bitcoin

Group frequently discusses:
Bitcoin

If someone asks:

"What's happening with BTC today?"

the AI can respond and search current information.

---

## 21.17 Human-Like Action Planner

Before sending anything, produce an internal action:

{
  action: "REPLY_TO_MESSAGE",

  targetMessageId: "...",

  content: "...",

  confidence: 0.91,

  needsSearch: true,

  needsMedia: false,

  mentionUsers: []
}

The WhatsApp adapter then executes the action.

---

## 21.18 Action Validation

Before execution:

Action Planner
      ↓
Validator
      ↓
Permissions
      ↓
Rate limits
      ↓
Safety checks
      ↓
WhatsApp

This prevents the model from directly controlling the WhatsApp account without constraints.

---

## 21.19 Confidence Threshold

Example:

Confidence > 0.75
→ Execute

0.50–0.75
→ Consider clarification / conservative response

< 0.50
→ Ignore

Thresholds should be configurable.

---

## 21.20 Self-Reflection

Before sending:

Does this answer the actual message?

Is this useful?

Am I repeating something?

Did someone already answer?

Am I over-talking?

Do I need a web search?

Should this be a reaction instead?

Am I tagging people unnecessarily?

This can be implemented as a lightweight validation step rather than an expensive second full AI conversation.

---

## 21.21 Chapter 21 Acceptance Criteria

☐ Understand direct mentions
☐ Understand quoted replies
☐ Detect conversations between members
☐ Decide when to remain silent
☐ Detect already-answered questions
☐ Select reply vs reaction
☐ Detect humor
☐ Consider group culture
☐ Consider member behavior
☐ Consider talkativeness
☐ Avoid unnecessary interruptions
☐ Create structured actions
☐ Validate actions
☐ Apply permissions/rate limits
☐ Use confidence thresholds
☐ Avoid repetitive replies

---

