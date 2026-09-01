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

export function createCoreSkillRegistry(): SkillRegistry {
  const registry = new SkillRegistry();
  const definitions: Array<Omit<SkillDefinition, "handler">> = [
    skill("reply_to_message", "Reply to message", "Send a response quoted to the triggering message.", "communication", "MESSAGE", ["message"], ["reply"], true),
    skill("mention_user", "Mention user", "Mention a verified group member.", "communication", "MESSAGE", ["memberId"], [], true),
    skill("react_to_message", "React to message", "Send a controlled reaction.", "communication", "MESSAGE", ["messageId", "reaction"], [], true),
    skill("send_text", "Send text", "Send a validated text message.", "communication", "MESSAGE", ["text"], [], true),
    skill("send_media", "Send media", "Send approved image, video, audio, or document media.", "media", "MESSAGE", ["mediaUrl"], ["mimeType"], true),
    skill("quote_context", "Quote context", "Load the message relationship behind a reply.", "conversation", "MESSAGE", ["messageId"], [], false),
    skill("silence_decision", "Silence decision", "Explicitly choose no response for low-value conversation.", "conversation", "MESSAGE", ["relevant"], [], false),
    skill("conversation_continuation", "Conversation continuation", "Continue a pending interaction after a tool result.", "conversation", "MESSAGE", ["conversationId"], ["result"], false),
    skill("detect_message_burst", "Detect message burst", "Group rapid messages into one conversational unit.", "conversation", "GROUP", ["messages"], [], false),
    skill("question_detection", "Question detection", "Detect whether a message asks a question.", "conversation", "MESSAGE", ["text"], [], false),
    skill("self_reference", "Self-reference", "Keep normal bot self-reference in first person.", "human_behavior", "GLOBAL", [], [], false),
    skill("natural_response_length", "Natural response length", "Adapt output length to persona and context.", "human_behavior", "MESSAGE", ["text"], ["responseLength"], false),
    skill("retrieve_memory", "Retrieve memory", "Retrieve relevant scoped long-term context.", "memory", "GROUP", ["query", "scopeId"], ["limit"], true),
    skill("store_memory", "Store memory", "Store a validated memory candidate with provenance.", "memory", "GROUP", ["memory"], [], true),
    skill("memory_consolidation", "Consolidate memory", "Merge duplicate observations without losing evidence.", "memory", "GROUP", ["memories"], [], true),
    skill("memory_privacy_isolation", "Memory privacy isolation", "Prevent memory crossing group and DM boundaries.", "memory", "GLOBAL", ["scopeId"], [], false),
    skill("web_search", "Web search", "Search the web through a configured provider.", "research", "GROUP", ["query"], [], true),
    skill("fact_verification", "Fact verification", "Cross-check important or current claims.", "research", "GROUP", ["evidence"], [], true),
    skill("provider_fallback", "Provider fallback", "Use the next healthy AI provider after a failure.", "orchestration", "GLOBAL", ["operation"], [], false),
    skill("voice_note_detection", "Voice note detection", "Recognize incoming audio messages.", "audio", "MESSAGE", ["messageType"], [], false),
    skill("speech_to_text", "Speech to text", "Transcribe an incoming voice note.", "audio", "MESSAGE", ["audio"], [], true),
    skill("text_to_speech", "Text to speech", "Generate audio when an approved provider is available.", "audio", "MESSAGE", ["text"], [], true),
    skill("media_search", "Media search", "Find safe media for an explicit request.", "media", "MESSAGE", ["query"], [], true),
    skill("skill_permission_check", "Skill permission check", "Keep permissions outside model-generated instructions.", "administration", "GLOBAL", ["skillId"], [], false),
    skill("skill_observability", "Skill observability", "Record status and latency without logging message contents.", "monitoring", "GLOBAL", ["skillId"], [], false),
  ];
  for (const definition of definitions) registry.register(definition);
  return registry;
}

function skill(skillId: string, name: string, description: string, category: string, scope: SkillScope, requiredInputs: string[], optionalInputs: string[], requiresPermission: boolean): Omit<SkillDefinition, "handler"> {
  return { skillId, name, description, category, version: "1.0.0", scope, enabled: true, requiresPermission, supportsChaining: true, triggers: [], requiredInputs, optionalInputs, timeoutMs: 15_000, dependencies: [], failureBehavior: "fallback", learningEnabled: true };
}

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
