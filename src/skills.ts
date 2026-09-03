import { BLUEPRINT_SKILL_CATALOG } from "./skill-catalog.js";

export type SkillScope = "GLOBAL" | "GROUP" | "MEMBER" | "DM" | "MESSAGE";

export interface SkillResult {
  success: boolean;
  data?: unknown;
  confidence?: number;
  sources?: unknown[];
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface SkillExecutionContext {
  groupId?: string;
  memberId?: string;
  messageId?: string;
  permissionGranted?: boolean;
}

export type SkillHandler = (input: Record<string, unknown>, context: SkillExecutionContext) => Promise<SkillResult> | SkillResult;

export interface SkillDefinition {
  skillId: string;
  name: string;
  description: string;
  category: string;
  version: string;
  scope: SkillScope;
  enabled: boolean;
  requiresPermission: boolean;
  supportsChaining: boolean;
  triggers: string[];
  requiredInputs: string[];
  optionalInputs: string[];
  timeoutMs: number;
  rateLimit?: number;
  dependencies: string[];
  failureBehavior: "fallback" | "retry" | "silence";
  learningEnabled: boolean;
  skillFile?: string;
  handler?: SkillHandler;
}

export interface SkillStatus extends Omit<SkillDefinition, "handler"> {
  available: boolean;
}

export class SkillRegistry {
  private readonly definitions = new Map<string, SkillDefinition>();

  register(definition: SkillDefinition): void {
    if (!/^[a-z][a-z0-9_]{1,80}$/.test(definition.skillId)) throw new Error("Invalid skill id");
    if (this.definitions.has(definition.skillId)) throw new Error(`Skill already registered: ${definition.skillId}`);
    if (definition.timeoutMs < 1 || definition.timeoutMs > 120_000) throw new Error(`Invalid timeout for skill: ${definition.skillId}`);
    this.definitions.set(definition.skillId, { ...definition, dependencies: [...definition.dependencies], triggers: [...definition.triggers] });
  }

  get(skillId: string): SkillDefinition | undefined {
    return this.definitions.get(skillId);
  }

  list(category?: string): SkillStatus[] {
    return [...this.definitions.values()]
      .filter((definition) => !category || definition.category === category)
      .sort((left, right) => left.skillId.localeCompare(right.skillId))
      .map(({ handler: _handler, ...definition }) => ({ ...definition, available: Boolean(_handler) && definition.enabled }));
  }

  discover(query: string): SkillStatus[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.list().sort((left, right) => scoreSkill(right, terms) - scoreSkill(left, terms));
  }

  setEnabled(skillId: string, enabled: boolean): void {
    const definition = this.definitions.get(skillId);
    if (!definition) throw new Error(`Unknown skill: ${skillId}`);
    definition.enabled = enabled;
  }
}

export class SkillExecutor {
  constructor(private readonly registry: SkillRegistry, private readonly onExecution?: (event: SkillExecutionEvent) => Promise<void> | void) {}

  async execute(skillId: string, input: Record<string, unknown>, context: SkillExecutionContext = {}): Promise<SkillResult> {
    const startedAt = Date.now();
    const definition = this.registry.get(skillId);
    if (!definition) return this.finish(skillId, startedAt, { success: false, error: "skill_not_registered" });
    if (!definition.enabled) return this.finish(skillId, startedAt, { success: false, error: "skill_disabled" });
    if (definition.requiresPermission && context.permissionGranted !== true) return this.finish(skillId, startedAt, { success: false, error: "skill_permission_denied" });
    if (definition.dependencies.some((dependency) => !this.registry.get(dependency)?.enabled)) return this.finish(skillId, startedAt, { success: false, error: "skill_dependency_unavailable" });
    const missing = definition.requiredInputs.filter((key) => input[key] === undefined || input[key] === null || input[key] === "");
    if (missing.length) return this.finish(skillId, startedAt, { success: false, error: `missing_input:${missing.join(",")}` });
    if (!definition.handler) return this.finish(skillId, startedAt, { success: false, error: "skill_unavailable" });
    try {
      const result = await runWithTimeout(() => definition.handler?.(input, context), definition.timeoutMs);
      return this.finish(skillId, startedAt, normalizeResult(result));
    } catch (error) {
      return this.finish(skillId, startedAt, { success: false, error: error instanceof Error ? error.message.slice(0, 300) : "skill_failed" });
    }
  }

  private async finish(skillId: string, startedAt: number, result: SkillResult): Promise<SkillResult> {
    await this.onExecution?.({ skillId, status: result.success ? "COMPLETED" : "FAILED", latencyMs: Date.now() - startedAt, error: result.error });
    return { ...result, metadata: { ...(result.metadata ?? {}), latencyMs: Date.now() - startedAt } };
  }
}

export interface SkillExecutionEvent {
  skillId: string;
  status: "COMPLETED" | "FAILED";
  latencyMs: number;
  error?: string;
}

export function createCoreSkillRegistry(handlers: Partial<Record<string, SkillHandler>> = {}): SkillRegistry {
  const registry = new SkillRegistry();
  for (const definition of BLUEPRINT_SKILL_CATALOG) {
    registry.register({ ...skill(definition.skillId, definition.name, definition.description, definition.category, definition.scope, definition.requiresPermission), ...(handlers[definition.skillId] ? { handler: handlers[definition.skillId] } : {}) });
  }
  return registry;
}

function skill(skillId: string, name: string, description: string, category: string, scope: SkillScope, requiresPermission: boolean): Omit<SkillDefinition, "handler"> {
  const inputs = SKILL_INPUTS[skillId] ?? { required: [], optional: [] };
  return { skillId, name, description, category, version: "1.0.0", scope, enabled: true, requiresPermission, supportsChaining: true, triggers: [], requiredInputs: inputs.required, optionalInputs: inputs.optional, timeoutMs: 15_000, dependencies: [], failureBehavior: "fallback", learningEnabled: true, skillFile: `skills/${skillId}/SKILL.md` };
}

const SKILL_INPUTS: Record<string, { required: string[]; optional: string[] }> = {
  reply_to_message: { required: ["message"], optional: ["reply"] },
  mention_user: { required: ["memberId"], optional: [] },
  mention_multiple_users: { required: ["memberIds"], optional: [] },
  mention_entire_group: { required: ["message"], optional: [] },
  react_to_message: { required: ["messageId", "reaction"], optional: [] },
  edit_bot_message: { required: ["messageId", "text"], optional: [] },
  delete_bot_message: { required: ["messageId"], optional: [] },
  send_text: { required: ["text"], optional: [] },
  send_media: { required: ["mediaUrl"], optional: ["mimeType"] },
  send_sticker: { required: ["mediaUrl"], optional: [] },
  quote_context: { required: ["messageId"], optional: [] },
  conversation_continuation: { required: ["conversationId"], optional: ["result"] },
  detect_message_burst: { required: ["messages"], optional: [] },
  question_detection: { required: ["text"], optional: [] },
  natural_response_length: { required: ["text"], optional: ["responseLength"] },
  retrieve_memory: { required: ["query", "scopeId"], optional: ["limit"] },
  store_memory: { required: ["memory"], optional: [] },
  memory_consolidation: { required: ["memories"], optional: [] },
  memory_privacy_isolation: { required: ["scopeId"], optional: [] },
  web_search: { required: ["query"], optional: [] },
  link_page_analysis: { required: ["url"], optional: ["question"] },
  brand_page_analysis: { required: ["url"], optional: ["question"] },
  freelance_opportunity_matching: { required: ["url", "profile"], optional: [] },
  fact_verification: { required: ["evidence"], optional: [] },
  provider_fallback: { required: ["operation"], optional: [] },
  voice_note_detection: { required: ["messageType"], optional: [] },
  audio_download: { required: ["messageId"], optional: [] },
  speech_to_text: { required: ["audio"], optional: [] },
  audio_understanding: { required: ["text"], optional: [] },
  text_to_speech: { required: ["text"], optional: [] },
  audio_response: { required: ["audio"], optional: [] },
  audio_fallback: { required: ["audio"], optional: [] },
  whatsapp_voice_call: { required: ["whatsappUserId"], optional: [] },
  spotify_music_recommendation: { required: ["request"], optional: [] },
  crypto_market_explanation: { required: ["question"], optional: [] },
  translation: { required: ["text"], optional: ["targetLanguage"] },
  language_detection: { required: ["text"], optional: [] },
  skill_permission_check: { required: ["skillId"], optional: [] },
  skill_observability: { required: ["skillId"], optional: [] },
};

function scoreSkill(skill: SkillStatus, terms: string[]): number {
  const haystack = `${skill.skillId} ${skill.name} ${skill.description} ${skill.category}`.toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function normalizeResult(value: SkillResult): SkillResult {
  return {
    success: value.success === true,
    ...(value.data !== undefined ? { data: value.data } : {}),
    ...(value.confidence !== undefined ? { confidence: Math.min(1, Math.max(0, value.confidence)) } : {}),
    ...(value.sources ? { sources: value.sources } : {}),
    ...(value.error ? { error: value.error.slice(0, 300) } : {}),
    ...(value.metadata ? { metadata: value.metadata } : {}),
  };
}

function runWithTimeout(handler: () => Promise<SkillResult> | SkillResult | undefined, ms: number): Promise<SkillResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("skill_timeout")), ms);
    Promise.resolve(handler()).then((result) => {
      clearTimeout(timer);
      resolve(result ?? { success: false, error: "skill_unavailable" });
    }, (error: unknown) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
