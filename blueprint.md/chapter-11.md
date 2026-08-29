# Chapter 11 — VOICE NOTES, AUDIO UNDERSTANDING & AUDIO RESPONSES

## 11.1 Purpose

The bot must be able to participate in WhatsApp conversations where members send voice notes.

A voice note should not be treated as an unreadable attachment.

The system should:

Receive Voice Note
        ↓
Download/Access Audio
        ↓
Convert if necessary
        ↓
Speech-to-Text
        ↓
Understand Transcript
        ↓
Decision Engine
        ↓
Reply / Ignore / Search / Task

The goal is for the AI to understand voice notes almost like normal text messages.

---

## 11.2 Supported Audio Flow

When a member sends:

[Voice Note]

the WhatsApp adapter should identify:

messageType = AUDIO

Then retrieve:

messageId
senderId
chatId
timestamp
mediaId
mimeType
duration

The media should be downloaded only when necessary.

---

## 11.3 Speech-to-Text

The system should have a provider abstraction:

Speech Service
│
├── Primary STT
│
├── Backup STT
│
└── Local/alternative STT

The exact provider should be configurable.

This prevents the entire bot from breaking if one speech service becomes unavailable.

---

## 11.4 Nigerian Pidgin

The speech system must be tested with:

Nigerian English
Nigerian Pidgin
English + Pidgin mixed
Accents
Slang
Names
Internet slang

Example voice:

«"Omo abeg tell that guy say make he send the money."»

Transcript:

Omo abeg tell that guy say make he send the money.

The AI should understand the meaning rather than trying to translate everything into formal English.

---

## 11.5 Transcript Confidence

Speech recognition can be wrong.

Store:

transcript
confidence
language
duration

Example:

Transcript confidence: 0.91

If confidence is very low, the AI should ask for clarification instead of confidently acting on a bad transcript.

---

## 11.6 Voice Note Context

The transcript must enter the same context pipeline as text:

Voice Note
   ↓
Transcript
   ↓
Message Object
   ↓
Context Builder
   ↓
Memory
   ↓
Decision Engine

The AI should not have one completely separate personality for voice notes.

---

## 11.7 Voice Note Example

Member sends:

[Voice Note]

"Omo AI, abeg check whether BTC don reach eighty thousand."

System:

STT
↓
"Omo AI, abeg check whether BTC don reach eighty thousand."
↓
Direct request
↓
Current information required
↓
Web search
↓
Response

The AI can answer in text or audio depending on configuration.

---

## 11.8 Audio Reply

If enabled:

AI response
     ↓
Text-to-Speech
     ↓
Audio
     ↓
WhatsApp

Dashboard:

Audio Replies

[ ON ]

Voice:
Female

Speed:
1.0x

Pitch:
Default

Maximum duration:
30 sec

---

## 11.9 Audio Fallback

If voice-note output is unsupported by the WhatsApp adapter:

Generate audio
      ↓
Send as supported audio attachment

The system should not claim that a voice note was sent if WhatsApp actually received another audio format.

---

## 11.10 When Should AI Send Audio?

The AI should not send audio for every response.

Possible rules:

Member sent voice note
        ↓
Higher probability of audio response

Member explicitly asks:
"Send voice"
        ↓
Audio

Normal text conversation
        ↓
Usually text

The dashboard can configure:

Always text
Adaptive
Match incoming audio
Always audio

---

## 11.11 Audio Length Protection

Avoid generating unnecessarily long audio.

Configuration:

Maximum audio duration
15 sec
30 sec
60 sec
Custom

If a response is too long:

Long answer
↓
Summarize
↓
Generate shorter audio

---

## 11.12 Voice Processing Queue

Multiple voice notes may arrive at once.

Use:

Audio Queue

Example:

Voice 1
Voice 2
Voice 3
   ↓
Queue
   ↓
Process

Avoid starting ten expensive transcription jobs simultaneously.

---

## 11.13 Audio Caching

If the same audio is encountered during processing, do not repeatedly transcribe it.

Use:

audioHash

to identify duplicate media.

---

## 11.14 Voice Privacy

Audio files should not remain permanently on the server unless required.

Recommended:

Receive
↓
Process
↓
Extract transcript
↓
Delete temporary audio

Long-term storage should be configurable.

---

## 11.15 Voice Note Acceptance Criteria

☐ Detect voice messages
☐ Download/access media
☐ Transcribe audio
☐ Support English
☐ Support Nigerian Pidgin
☐ Track transcription confidence
☐ Feed transcript into normal AI pipeline
☐ Support audio replies
☐ Support TTS provider fallback
☐ Configure audio response behavior
☐ Configure maximum audio duration
☐ Queue voice processing
☐ Avoid duplicate transcription
☐ Clean temporary media
☐ Handle transcription failures

---

