// Phoenix model pools, sourced from the full sweep (phoenix_models.json, 477 models checked).
// Order = preference. Paid custom models first, then every free model that answered cleanly.
// Failover walks the list; a model that fails is marked down for a cooldown and retried on a timer.

export const PHOENIX_PAID_TEXT_MODELS = ["gpt-6-astra", "gpt-5.6-sol", "gpt-6.1-sol"] as const;

export const PHOENIX_FREE_TEXT_MODELS = [
  "recursive/flint-v1.0:free",
  "xingchen-agi/xing4.0-29b-a4b:free",
  "dots-studio/dots-3-note-preview:free",
  "liquid/lfm-2.5-2.6b:free",
  "nvidia/nemotron-3.5-lightning:free",
  "poolside/laguna-s-2.1:free",
  "poolside/laguna-xs-2.1:free",
  "cohere/north-mini-code:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "google/gemma-4-26b-a4b-it:free",
  "openrouter/free",
  "anyrouter-free",
  "openrouter-free",
  "hamro-gpt-oss-120b",
] as const;

export const PHOENIX_TEXT_MODEL_POOL: readonly string[] = [...PHOENIX_PAID_TEXT_MODELS, ...PHOENIX_FREE_TEXT_MODELS];

// Vision pool: only the paid custom models were verified to read images on /v1/responses.
// The free models report no image input in metadata, so they are not in this pool.
// Gemini vision stays as the last resort in the media fallback chain.
export const PHOENIX_VISION_MODEL_POOL: readonly string[] = [...PHOENIX_PAID_TEXT_MODELS];

export function parseModelList(value: string | undefined, fallback: readonly string[]): string[] {
  const parsed = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const models = [...new Set(parsed.length ? parsed : fallback)];
  return models.slice(0, 50);
}

// Down-marking for a pool: a model that fails is skipped until its cooldown passes.
export class ModelHealth {
  private readonly downUntil = new Map<string, number>();

  constructor(private readonly cooldownMs: number) {}

  isUp(model: string, now = Date.now()): boolean {
    const until = this.downUntil.get(model);
    return until === undefined || until <= now;
  }

  markDown(model: string, now = Date.now()): void {
    this.downUntil.set(model, now + this.cooldownMs);
  }

  markUp(model: string): void {
    this.downUntil.delete(model);
  }
}
