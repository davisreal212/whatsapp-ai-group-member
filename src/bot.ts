import { randomUUID } from "node:crypto";
import type { WAMessage } from "@whiskeysockets/baileys";
import { ActionService, type OutboundTransport } from "./actions.js";
import { DecisionEngine } from "./decision.js";
import type { AppConfig, CanonicalMessage, GroupRecord } from "./types.js";
import { MemoryService } from "./memory.js";
import { isCurrentInformationQuestion, evaluateInboundPolicy } from "./policy.js";
import { ProviderRouter, type ProviderInput } from "./providers.js";
import { ResearchService, TavilyProvider } from "./research.js";
import type { Store } from "./store.js";
import { normalizeMessage } from "./normalize.js";
import type { DiscoveredDirectMessage, DiscoveredGroup } from "./whatsapp.js";

export class BotRuntime {
  readonly memory: MemoryService;
  readonly providers: ProviderRouter;
  readonly research: ResearchService;
  readonly decisions: DecisionEngine;
  readonly actions: ActionService;

  constructor(
    readonly store: Store,
    readonly config: AppConfig,
    private readonly transport: OutboundTransport,
  ) {
    this.memory = new MemoryService(store);
    this.providers = new ProviderRouter(store, config);
    this.research = new ResearchService(store, new TavilyProvider(config.tavilyApiKey));
    this.decisions = new DecisionEngine(this.providers);
    this.actions = new ActionService(store, config, transport);
  }

  async init(): Promise<void> {
    await this.store.init();
    const pruned = await this.store.pruneExpired(this.config.messageRetentionDays);
    if (Object.values(pruned).some((count) => count > 0)) await this.log("retention.pruned", "info", { ...pruned });
    const settings = this.store.settings();
    if (settings?.personality) this.config.personality = { ...this.config.personality, ...settings.personality };
    if (settings?.outboundPaused !== undefined) this.config.outboundPaused = settings.outboundPaused;
    if (settings?.aiProcessingPaused !== undefined) this.config.aiProcessingPaused = settings.aiProcessingPaused;
    if (settings?.directMessageAllowlist !== undefined) this.config.directMessageAllowlist = [...settings.directMessageAllowlist];
    if (!settings) {
      await this.store.updateSettings({ outboundPaused: this.config.outboundPaused, aiProcessingPaused: this.config.aiProcessingPaused, directMessageAllowlist: this.config.directMessageAllowlist, personality: this.config.personality });
    }
  }

  async connect(phoneNumber?: string): Promise<void> {
    if (!("connect" in this.transport)) throw new Error("WhatsApp connection is not configured");
    await (this.transport as unknown as { connect(phone?: string): Promise<void> }).connect(phoneNumber);
  }

  async disconnect(): Promise<void> {
    if (!("disconnect" in this.transport)) throw new Error("WhatsApp connection is not configured");
    await (this.transport as unknown as { disconnect(): Promise<void> }).disconnect();
  }

  async listGroups(): Promise<DiscoveredGroup[]> {
    if (!("listGroups" in this.transport)) return [];
    return (this.transport as unknown as { listGroups(): Promise<DiscoveredGroup[]> }).listGroups();
  }

  listDirectMessages(): DiscoveredDirectMessage[] {
    if (!("listDirectMessages" in this.transport)) return [];
    return (this.transport as unknown as { listDirectMessages(): DiscoveredDirectMessage[] }).listDirectMessages();
  }

  async handleRawMessage(raw: WAMessage): Promise<void> {
    const message = normalizeMessage(raw as unknown as Parameters<typeof normalizeMessage>[0], this.config.botJid);
    if (!message) {
      await this.log("message.invalid", "warn", { reason: "normalization_failed" });
      return;
    }
    await this.store.incrementMetric("observed");
    const group = message.groupId ? this.store.group(message.groupId) : undefined;
    const policy = evaluateInboundPolicy(message, group, this.config);
    if (!policy.allowed) {
      await this.log("message.filtered", "info", {
        reason: policy.reason,
        ...(message.isGroup
          ? {}
          : {
              chatId: message.chatId,
              senderId: message.senderId,
              ...(message.senderPhone ? { senderPhone: message.senderPhone } : {}),
            }),
      }, message);
      return;
    }

    const stored = await this.store.storeMessage({ ...message, storedAt: Date.now() });
    if (!stored) {
      await this.log("message.duplicate", "info", { reason: "event_id_already_seen" }, message);
      return;
    }
    await this.memory.observe(message);
    const contextGroup = group ?? directMessageContext(message.chatId);
    const context = this.memory.context(contextGroup, message.senderId, this.personality(contextGroup));
    const result = await this.decisions.decide(message, contextGroup, context, this.config);
    if (!result.local.relevant) {
      await this.store.incrementMetric("ignoredLocally");
      await this.log("decision.ignore_local", "info", { reason: result.plan.reason }, message);
      return;
    }

    let plan = result.plan;
    const currentQuestion = isCurrentInformationQuestion(message.text ?? "");
    const evidence = plan.decision !== "IGNORE" && (plan.needsWeb || currentQuestion)
      ? await this.research.research(message.text ?? "", this.config.tavilyMaxResults)
      : undefined;
    if (plan.needsWeb || currentQuestion) {
      plan = { ...plan, needsWeb: true };
    }
    if (plan.decision !== "IGNORE" && !plan.text && !["REACT", "SEND_IMAGE", "SEND_AUDIO"].includes(plan.decision)) {
      const input: ProviderInput = {
        messageText: message.text ?? message.media?.caption ?? "",
        messageType: message.type,
        ...(message.senderName ? { senderName: message.senderName } : {}),
        context,
        ...(evidence ? { evidence } : {}),
      };
      const response = await this.providers.generateResponse(input, message.groupId);
      if (response) plan = { ...plan, text: response };
    }
    await this.actions.execute(plan, message, group);
  }

  async syncGroups(groups: DiscoveredGroup[]): Promise<void> {
    const discoveredIds = new Set(groups.map((group) => group.id));
    for (const current of this.store.groups()) {
      if (!discoveredIds.has(current.id)) await this.store.deleteGroup(current.id);
    }
    for (const discovered of groups) {
      const current = this.store.group(discovered.id);
      const group: GroupRecord = {
        id: discovered.id,
        whatsappGroupId: discovered.id,
        subject: discovered.subject,
        participantCount: discovered.participantCount,
        isAdmin: discovered.isAdmin,
        enabled: current?.enabled ?? false,
        aiPaused: current?.aiPaused ?? false,
        ...(current?.personalityOverride ? { personalityOverride: current.personalityOverride } : {}),
        lastSeenAt: Date.now(),
      };
      await this.store.upsertGroup(group);
    }
    await this.log("groups.synced", "info", { count: groups.length });
  }

  async setDirectMessageAllowlist(contacts: string[]): Promise<string[]> {
    const allowlist = [...new Set(contacts.map((contact) => contact.trim()).filter(Boolean))];
    this.config.directMessageAllowlist = allowlist;
    await this.store.updateSettings({ directMessageAllowlist: allowlist });
    await this.log("dm_allowlist.changed", "warn", { count: allowlist.length });
    return allowlist;
  }

  async setGroupEnabled(id: string, enabled: boolean): Promise<GroupRecord | undefined> {
    const group = await this.store.updateGroup(id, { enabled });
    if (group) await this.log("group.authorization_changed", "info", { enabled }, undefined, id);
    return group;
  }

  async setGroupPaused(id: string, aiPaused: boolean): Promise<GroupRecord | undefined> {
    const group = await this.store.updateGroup(id, { aiPaused });
    if (group) await this.log("group.pause_changed", "info", { aiPaused }, undefined, id);
    return group;
  }

  async setGroupPersonality(id: string, personality: Partial<AppConfig["personality"]>): Promise<GroupRecord | undefined> {
    const group = await this.store.updateGroup(id, { personalityOverride: personality });
    if (group) await this.log("group.personality_changed", "info", { fields: Object.keys(personality) }, undefined, id);
    return group;
  }

  async setPersonality(personality: Partial<AppConfig["personality"]>): Promise<void> {
    this.config.personality = { ...this.config.personality, ...personality };
    await this.store.updateSettings({ personality });
    await this.log("personality.changed", "info", { fields: Object.keys(personality) });
  }

  async resetMemory(scopeId: string): Promise<number> {
    const count = await this.store.deleteMemories(scopeId);
    await this.log("memory.deleted", "info", { scopeId, count });
    return count;
  }

  async setControls(update: { outboundPaused?: boolean; aiProcessingPaused?: boolean }): Promise<void> {
    if (update.outboundPaused !== undefined) this.config.outboundPaused = update.outboundPaused;
    if (update.aiProcessingPaused !== undefined) this.config.aiProcessingPaused = update.aiProcessingPaused;
    await this.store.updateSettings({
      ...(update.outboundPaused !== undefined ? { outboundPaused: update.outboundPaused } : {}),
      ...(update.aiProcessingPaused !== undefined ? { aiProcessingPaused: update.aiProcessingPaused } : {}),
    });
    await this.log("controls.changed", "warn", {
      outboundPaused: this.config.outboundPaused,
      aiProcessingPaused: this.config.aiProcessingPaused,
    });
  }

  dashboardState(): Record<string, unknown> {
    const snapshot = this.store.snapshot;
    return {
      connection: snapshot.runtime,
      safety: {
        groupOnlyMode: this.config.groupOnlyMode,
        directMessageAllowlist: this.config.directMessageAllowlist,
        outboundPaused: this.config.outboundPaused,
        aiProcessingPaused: this.config.aiProcessingPaused,
        dryRun: this.config.dryRun,
      },
      groups: this.store.groups(),
      metrics: snapshot.runtime.metrics,
      providers: this.providers.statuses(),
      research: { tavilyAvailable: Boolean(this.config.tavilyApiKey) },
      recentLogs: this.store.logs(30),
      recentActions: this.store.actions(30),
    };
  }

  private personality(group: GroupRecord) {
    return { ...this.config.personality, ...(group.personalityOverride ?? {}) };
  }

  private async log(
    event: string,
    level: "info" | "warn" | "error",
    details: Record<string, unknown>,
    message?: CanonicalMessage,
    groupId?: string,
  ): Promise<void> {
    await this.store.addLog({
      id: randomUUID(),
      event,
      level,
      ...(message?.id ? { messageId: message.id } : {}),
      ...(groupId ?? message?.groupId ? { groupId: groupId ?? message?.groupId } : {}),
      details,
      createdAt: Date.now(),
    });
  }
}

function directMessageContext(chatId: string): GroupRecord {
  return {
    id: chatId,
    whatsappGroupId: chatId,
    subject: "Direct message",
    participantCount: 1,
    isAdmin: false,
    enabled: true,
    aiPaused: false,
    lastSeenAt: Date.now(),
  };
}
