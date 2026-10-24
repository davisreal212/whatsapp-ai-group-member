// Fallback lines for when media (voice note, image, generic DM) can't be processed.
// Rotates through variants per person per day so the same line never goes out twice
// to the same person in one day, and never repeats back-to-back.

export type FallbackKind = "voice" | "image" | "generic";

export const FALLBACK_VARIANTS: Record<FallbackKind, readonly string[]> = {
  voice: [
    "voice cut out on my end, say it in text?",
    "that voice note didnt come through, type it out for me?",
    "lost ur voice note 😭 say it in text?",
    "my ears didnt get that one, can u type it?",
    "voice note glitched on me, text it instead?",
    "didnt catch ur voice note, drop it in text?",
  ],
  image: [
    "my eyes glitched, send that again",
    "the pic wouldnt load on my end, resend?",
    "that image didnt open for me lol, send again?",
    "my screen went blank on that pic, try again?",
  ],
  generic: [
    "hey, my brain lagged for a sec. send that again?",
    "brain froze on that one lol, say it again?",
    "lost my train of thought there, send it once more?",
    "ugh my head glitched, run that by me again?",
    "sorry bro my brain buffered, try that again?",
    "hm my brain dropped that, can u resend?",
  ],
};

type Usage = { day: string; used: Set<string>; last?: string };

export class FallbackRotator {
  private readonly usage = new Map<string, Usage>();

  constructor(private readonly now: () => number = Date.now) {}

  private dayKey(): string {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  /** Pick the next fallback line for this person today. Never returns the same line twice to them in one day while variants remain, and never the same line back-to-back. */
  pick(kind: FallbackKind, personKey: string): string {
    const day = this.dayKey();
    const key = `${kind}:${personKey}`;
    let state = this.usage.get(key);
    if (!state || state.day !== day) {
      state = { day, used: new Set() };
      this.usage.set(key, state);
    }
    const variants = FALLBACK_VARIANTS[kind];
    let candidates = variants.filter((line) => !state.used.has(line));
    if (!candidates.length) {
      // Cycle exhausted for today: start over, but skip the line we just sent.
      state.used.clear();
      candidates = variants.filter((line) => line !== state.last);
      if (!candidates.length) candidates = [...variants];
    }
    const line = candidates[Math.floor(Math.random() * candidates.length)] ?? variants[0]!;
    state.used.add(line);
    state.last = line;
    return line;
  }

  /** Test/ops helper: forget everything. */
  reset(): void {
    this.usage.clear();
  }
}

export const fallbackRotator = new FallbackRotator();

export function pickFallbackLine(kind: FallbackKind, personKey: string): string {
  return fallbackRotator.pick(kind, personKey);
}

// Plain-text "hold up" line for when the AI walk fails on a normal text message.
// Media fallbacks above are for real media failures only; this is never used for text.
export const HOLD_UP_VARIANTS: readonly string[] = [
  "hold up, thinking",
  "hold up, one sec",
  "give me a sec, thinking",
];

export const EXCUSE_MAX_PER_HOUR = 1;
export const EXCUSE_MAX_IN_A_ROW = 2;
const HOUR_MS = 3_600_000;

/** Rate-limits fallback excuses per sender: max 1 per hour, never more than 2 in a row without a real AI reply. */
export class ExcuseLimiter {
  private readonly state = new Map<string, { lastAt: number; inRow: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Returns true if an excuse may be sent to this sender now, and records it. */
  tryUse(senderKey: string): boolean {
    const t = this.now();
    const s = this.state.get(senderKey) ?? { lastAt: -Infinity, inRow: 0 };
    if (t - s.lastAt < HOUR_MS) return false;
    if (s.inRow >= EXCUSE_MAX_IN_A_ROW) return false;
    this.state.set(senderKey, { lastAt: t, inRow: s.inRow + 1 });
    return true;
  }

  /** Call when a real AI reply goes out to this sender: resets the in-a-row streak. */
  noteRealReply(senderKey: string): void {
    const s = this.state.get(senderKey);
    if (s) s.inRow = 0;
  }

  reset(): void {
    this.state.clear();
  }
}

export const excuseLimiter = new ExcuseLimiter();

export function pickHoldUpLine(personKey: string): string {
  return HOLD_UP_VARIANTS[Math.floor(Math.random() * HOLD_UP_VARIANTS.length)] ?? HOLD_UP_VARIANTS[0]!;
}
