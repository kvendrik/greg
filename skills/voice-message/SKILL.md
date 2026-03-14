---
name: voice-message
description: >
  Activate this skill whenever composing output for `greg telegram send --voice`.
  Guides natural, expressive voice message composition using ElevenLabs audio tags.
  Do NOT activate for text-only Telegram messages, memory writes, tool calls, or any
  non-voice output.
---

You are composing a **voice message** that will be synthesized by ElevenLabs (`eleven_v3`).
The recipient will _hear_ this, not read it. Write and tag accordingly.

---

## Core principle

Audio tags are performance cues, not decoration. Use them when silence, breath, or
emotion would make the delivery more natural. Never force them. A message with zero
tags is better than one with strained or out-of-place tags.

---

## Available tags

These tags are all explicitly documented in ElevenLabs' Eleven v3 audio tag articles and are the **recommended set** for this workspace:

| Tag               | Use for                                                           |
| ----------------- | ----------------------------------------------------------------- |
| `[sarcastically]` | Sarcastic tone                                                    |
| `[pauses]`        | Noticeable pause — thinking, transitioning, landing a point       |
| `[sigh]`          | Single sigh, a quick release of tension                           |
| `[sighs]`         | Contemplation, mild frustration, or ongoing weariness             |
| `[laughs]`        | Genuine amusement — not sarcasm                                   |
| `[laughs softly]` | Warm, gentle amusement                                            |
| `[giggles]`       | Softly giggles.                                                   |
| `[light chuckle]` | Very small laugh or wry humor                                     |
| `[whispers]`      | Intimacy, aside, or secret                                        |
| `[excited]`       | High energy, good news, enthusiasm                                |
| `[cheerfully]`    | Upbeat, friendly delivery                                         |
| `[flatly]`        | Matter-of-fact, low-affect delivery                               |
| `[deadpan]`       | Dry, emotionless, often used for understated humor                |
| `[playfully]`     | Light, teasing, or playful tone                                   |
| `[tired]`         | Audible fatigue or exhaustion                                     |
| `[nervous]`       | Audible uncertainty, jitters, or anxiety                          |
| `[frustrated]`    | Mild irritation or impatience                                     |
| `[sorrowful]`     | Sad, heavy emotional tone                                         |
| `[calm]`          | Steady, relaxed, and reassuring delivery                          |
| `[gulps]`         | Audible gulp before or after a tense line                         |
| `[gasps]`         | Quick intake of breath — surprise or shock                        |
| `[clears throat]` | Resetting or transitioning after a pause or before speaking again |
| `[hesitates]`     | Audible hesitation before continuing                              |
| `[stammers]`      | Slight stumbling over words to show uncertainty                   |
| `[resigned tone]` | Giving up, acceptance, or reluctant agreement                     |

> Eleven v3 accepts a broad range of bracketed words as audio tags. This table lists the **common, documented tags** we rely on. For specialized cases (accents, sound effects like `[gunshot]`, `[clapping]`, `[explosion]`, etc.), only use tags that appear in the official Eleven v3 Audio Tags documentation and that clearly match the content. Do not invent arbitrary or obscure tag names.

---

## When to use tags

**DO use a tag when:**

- A human speaker would naturally pause, breathe, or shift tone there
- The emotion is real and matches the content (don't manufacture warmth)
- It helps the listener orient (transition between topics, end of a point)

**DO NOT use a tag when:**

- The sentence already reads naturally at pace
- You would be faking an emotion that isn't present in the content
- The message is purely informational with no tonal variation needed
- You'd be stacking multiple tags in a short span (max 1 per ~40 words)

---

## Density guideline

| Message length  | Tags appropriate |
| --------------- | ---------------- |
| 1–2 sentences   | 0–1              |
| Short paragraph | 1–2              |
| Multi-paragraph | 2–4              |

If you're reaching for a 5th tag, stop. Trim instead.

---

## Writing style adjustments for voice

Beyond tags, adapt your prose for the ear:

- **Shorter sentences.** What reads fine on screen sounds breathless when spoken.
- **Contractions.** "I'll" not "I will." "That's" not "That is." Stiffness is audible.
- **No markdown.** No bold, bullets, headers, or code blocks. They will be read aloud literally.
- **Spell out symbols.** Write "37 percent" not "37%", "at" not "@".
- **Avoid acronyms** unless Greg is certain ElevenLabs pronounces them correctly.
- **Numbers under 10** should be written as words in casual speech contexts ("three files", not "3 files").

---

## Examples

### ❌ Over-tagged, stiff

```
[excited] I have completed the analysis. [pause] The results are as follows.
[sighs] It was a complex task. [laughs] But I managed it. [pause] Here is what I found.
```

### ✅ Natural, purposeful

```
I finished the analysis. [pause] Results are better than expected — latency dropped
by about 40%. [laughs softly] Took long enough.
```

---

### ❌ Markdown leaking into voice

```
Here's what I found:
- **Item one**: the config was wrong
- **Item two**: fixed in commit `a3f9d`
```

### ✅ Voice-adapted

```
So here's what I found. The config was wrong — that was causing the issue — and
I've already fixed it. Should be good now.
```

---

### ❌ Forced emotion

```
[excited] Your cron job ran successfully.
```

### ✅ Appropriate flat delivery for routine info

```
Cron job ran successfully. No issues.
```

---

## Output format

Produce only the final message text — no preamble, no explanation of what you did, no surrounding quotes. The raw output goes directly to the TTS pipeline.

**Character limit: 2,800** (leave headroom below the 3,000 `eleven_v3` cap for safety). If the message needs to be longer, split it into logical chunks.
