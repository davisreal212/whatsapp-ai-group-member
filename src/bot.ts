import { randomUUID } from "node:crypto";
import type { WAMessage } from "@whiskeysockets/baileys";
import { ActionService, type OutboundTransport } from "./actions.js";
import { DecisionEngine } from "./decision.js";
import type { AppConfig, CanonicalMessage, GroupRecord, InboundJobRecord, TaskRecord } from "./types.js";
import { MemoryService } from "./memory.js";
import { isCurrentInformationQuestion, evaluateInboundPolicy } from "./policy.js";
import { ProviderRouter, type ProviderInput } from "./providers.js";
import { DuckDuckGoImageProvider, DuckDuckGoProvider, ResearchService, TavilyProvider, WikimediaImageProvider } from "./research.js";
import type { Store } from "./store.js";
import { normalizeMessage } from "./normalize.js";
import type { DiscoveredDirectMessage, DiscoveredGroup } from "./whatsapp.js";
import { TaskService } from "./tasks.js";
import { ElevenLabsSpeechToTextProvider, ElevenLabsTextToSpeechProvider, FallbackSpeechToTextProvider, FallbackTextToSpeechProvider, GeminiVisionProvider, GroqSpeechToTextProvider, MediaProcessor, OpenAITextToSpeechProvider } from "./media.js";
import { BackupService } from "./backup.js";
import { KeyedJobQueue } from "./queue.js";
import { formatNigeriaDateTime, NIGERIA_TIME_ZONE } from "./time.js";
import { groupActivityState, groupParticipation } from "./participation.js";
import type { ParticipationSettings } from "./types.js";
import { isSafeHttpsUrl } from "./network.js";

export class BotRuntime {
  readonly memory: MemoryService;
  readonly providers: ProviderRouter;
  readonly research: ResearchService;
  readonly decisions: DecisionEngine;
  readonly actions: ActionService;
  readonly tasks: TaskService;
  readonly media: MediaProcessor;
  readonly backups: BackupService;
  private readonly inboundQueue = new KeyedJobQueue(4);
  private lastDecisionDiagnostics?: Record<string, unknown>;

  constructor(
    readonly store: Store,
    readonly config: AppConfig,
    private readonly transport: OutboundTransport,
  ) {
    this.memory = new MemoryService(store);
    this.providers = new ProviderRouter(store, config);
    this.research = new ResearchService(store, [new TavilyProvider(config.tavilyApiKey), new DuckDuckGoProvider()], [new DuckDuckGoImageProvider(), new WikimediaImageProvider()]);
    this.decisions = new DecisionEngine(this.providers);
    this.actions = new ActionService(store, config, transport);
    this.tasks = new TaskService(store, config, transport);
    this.media = new MediaProcessor(new FallbackSpeechToTextProvider([new GroqSpeechToTextProvider(config.groqApiKey), new ElevenLabsSpeechToTextProvider(config.elevenLabsApiKey)]), new GeminiVisionProvider(config.geminiApiKey, config.geminiModel), new FallbackTextToSpeechProvider([new OpenAITextToSpeechProvider(config.ttsApiKey, config.ttsBaseUrl, config.ttsModel, config.ttsVoice), new ElevenLabsTextToSpeechProvider(config.elevenLabsApiKey, config.elevenLabsVoiceId)]), config.mediaDownloadsPerHour);
    this.backups = new BackupService(store, config.dataDir, config.backupIntervalHours, config.backupRetentionCount);
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
    if (settings?.participation) this.config.participation = { ...this.config.participation, ...settings.participation };
    this.config.groupCooldownMs = this.config.participation.groupCooldownMs;
    if (!settings) {
      await this.store.updateSettings({ outboundPaused: this.config.outboundPaused, aiProcessingPaused: this.config.aiProcessingPaused, directMessageAllowlist: this.config.directMessageAllowlist, personality: this.config.personality, participation: this.config.participation });
    }
    this.actions.start();
    this.backups.start();
  }

  async connect(phoneNumber?: string): Promise<void> {
    if (!("connect" in this.transport)) throw new Error("WhatsApp connection is not configured");
    await (this.transport as unknown as { connect(phone?: string): Promise<void> }).connect(phoneNumber);
  }

  async disconnect(): Promise<void> {
    if (!("disconnect" in this.transport)) throw new Error("WhatsApp connection is not configured");
    await (this.transport as unknown as { disconnect(): Promise<void> }).disconnect();
  }

  startBackgroundWorkers(): void {
    this.tasks.start();
    void this.drainInboundJobs();
  }

  async stopBackgroundWorkers(): Promise<void> {
    this.tasks.stop();
    await this.actions.stop();
    this.backups.stop();
  }

  async cancelTask(id: string): Promise<TaskRecord | undefined> {
    return this.tasks.cancelTask(id);
  }

  async updateTask(id: string, update: Partial<Pick<TaskRecord, "message" | "triggerAt" | "recurrence" | "status">>): Promise<TaskRecord | undefined> {
    const task = await this.store.updateTask(id, update);
    if (task) await this.log("task.updated", "info", { taskId: id, fields: Object.keys(update) });
    return task;
  }

  setBotIdentities(identities: string[]): void {
    this.config.botJids = [...new Set([...(this.config.botJids ?? []), ...identities])];
    if (!this.config.botJid && identities[0]) this.config.botJid = identities[0];
  }

  async listGroups(): Promise<DiscoveredGroup[]> {
    if (!("listGroups" in this.transport)) return [];
    return (this.transport as unknown as { listGroups(): Promise<DiscoveredGroup[]> }).listGroups();
  }

  listDirectMessages(): DiscoveredDirectMessage[] {
    if (!("listDirectMessages" in this.transport)) return [];
    return (this.transport as unknown as { listDirectMessages(): DiscoveredDirectMessage[] }).listDirectMessages();
  }

  async handleRawMessage(raw: WAMessage, loadMedia?: () => Promise<import("./media.js").DownloadedMedia>): Promise<void> {
    const message = normalizeMessage(raw as unknown as Parameters<typeof normalizeMessage>[0], this.config.botJid);
    if (!message) {
      await this.log("message.invalid", "warn", { reason: "normalization_failed" });
      return;
    }
    await this.inboundQueue.enqueueAndWait(message.chatId, () => this.processInboundMessage(message, loadMedia));
  }

  private async processInboundMessage(initialMessage: CanonicalMessage, loadMedia?: () => Promise<import("./media.js").DownloadedMedia>): Promise<void> {
    const existing = this.store.inboundJobByMessageId(initialMessage.id);
    if (existing?.status === "COMPLETED") return;
    const draft: InboundJobRecord = existing ?? {
      id: randomUUID(),
      messageId: initialMessage.id,
      chatId: initialMessage.chatId,
      message: initialMessage,
      status: "PENDING",
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const created = existing ? true : await this.store.createInboundJob(draft);
    const job = created ? draft : this.store.inboundJobByMessageId(initialMessage.id);
    if (!job || job.status === "COMPLETED") return;
    if ((job.nextAttemptAt ?? 0) > Date.now()) await waitFor(Math.min(job.nextAttemptAt as number - Date.now(), 5_000));
    await this.store.updateInboundJob(job.id, { status: "PROCESSING", attempts: job.attempts + 1, nextAttemptAt: undefined, lastError: undefined });
    let failed = false;
    let typing = false;
    let message = initialMessage;
    try {
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

      if (this.transport.sendTyping) {
        await this.transport.sendTyping(message.chatId, true).catch(() => undefined);
        typing = true;
      }

    if (message.type === "audio" && message.media?.hasDownloadableContent && loadMedia) {
      try {
        const transcript = await this.media.transcribeAudio(loadMedia, message.chatId);
        message = { ...message, text: transcript.text, transcriptConfidence: transcript.confidence, ...(transcript.language ? { transcriptLanguage: transcript.language } : {}) };
        await this.log("media.transcribed", "info", { type: "audio", confidence: transcript.confidence, ...(transcript.language ? { language: transcript.language } : {}) }, message);
      } catch (error) {
        await this.log("media.transcription_failed", "warn", { type: "audio", error: error instanceof Error ? error.message : "unknown" }, message);
        message = { ...message, transcriptConfidence: 0 };
      }
    } else if (message.type === "audio") {
      message = { ...message, transcriptConfidence: 0 };
    }
    if (["image", "sticker"].includes(message.type) && message.media?.hasDownloadableContent && loadMedia) {
      try {
        const vision = await this.media.analyzeImage(loadMedia, message.chatId);
        message = { ...message, text: [message.text, vision.description, vision.ocrText].filter(Boolean).join("\n"), media: { ...message.media, description: vision.description, ...(vision.ocrText ? { ocrText: vision.ocrText } : {}) } };
        await this.log("media.image_analyzed", "info", { type: message.type, confidence: vision.confidence, ocr: Boolean(vision.ocrText) }, message);
      } catch (error) {
        await this.log("media.image_analysis_failed", "warn", { type: "image", error: error instanceof Error ? error.message : "unknown" }, message);
      }
    }
    if (message.type === "document" && message.media?.hasDownloadableContent && loadMedia && isTextDocument(message.media.mimeType)) {
      try {
        const document = await this.media.extractDocumentText(loadMedia, message.chatId);
        message = { ...message, text: [message.text, document.text].filter(Boolean).join("\n"), media: { ...message.media, description: "Text document extracted locally" } };
        await this.log("media.document_extracted", "info", { type: "document", mimeType: document.mimeType }, message);
      } catch (error) {
        await this.log("media.document_extraction_failed", "warn", { type: "document", error: error instanceof Error ? error.message : "unknown" }, message);
      }
    }

    const stored = await this.store.storeMessage({ ...message, storedAt: Date.now() });
    if (!stored) {
      await this.log("message.duplicate", "info", { reason: "event_id_already_seen" }, message);
      return;
    }
    await this.memory.observe(message);
    const contextGroup = group ?? directMessageContext(message.chatId);
    const context = this.memory.context(contextGroup, message.senderId, this.personality(contextGroup), message.text ?? message.media?.caption ?? "");
    if (!message.isGroup) {
      const task = await this.tasks.handleMessage(message);
      if (task.handled) {
        await this.executeTaskResult(task, message, group);
        return;
      }
    }
    const priceReply = await this.tasks.currentPriceReply(message.text ?? "");
    if (priceReply) {
      await this.executeTaskResult({ reply: priceReply }, message, group);
      return;
    }
    const dateTimeReply = this.tasks.currentNigeriaDateTimeReply(message.text ?? "");
    if (dateTimeReply) {
      await this.executeTaskResult({ reply: dateTimeReply }, message, group);
      return;
    }
    const result = await this.decisions.decide(message, contextGroup, context, { ...this.config, alwaysReplyToAllowedDm: !message.isGroup });
    this.lastDecisionDiagnostics = {
      messageId: message.id,
      ...(message.groupId ? { groupId: message.groupId } : { chatId: message.chatId }),
      messageType: message.type,
      localRelevance: result.local.reason,
      directed: result.local.directed,
      decision: result.plan.decision,
      decisionReason: result.plan.reason,
      searchRequired: false,
      mediaSearchRequired: false,
      context: { recentMessages: context.recentMessages.length, memories: context.memories.length, recentActions: context.recentActions?.length ?? 0, memberProfile: Boolean(context.member) },
      recordedAt: Date.now(),
    };
    if (!result.local.relevant) {
      await this.store.incrementMetric("ignoredLocally");
      await this.log("decision.ignore_local", "info", {
        reason: result.plan.reason,
        localReason: result.local.reason,
        directed: result.local.directed,
      }, message);
      return;
    }

    let plan = result.plan;
    if (result.local.directed) {
      const task = await this.tasks.handleMessage(message);
      if (task.handled) {
        await this.executeTaskResult(task, message, group);
        return;
      }
    }
    const currentQuestion = isCurrentInformationQuestion(message.text ?? "");
    this.lastDecisionDiagnostics = { ...this.lastDecisionDiagnostics, searchRequired: Boolean(plan.needsWeb || currentQuestion), mediaSearchRequired: plan.decision === "SEND_IMAGE" };
    const evidence = plan.decision !== "IGNORE" && (plan.needsWeb || currentQuestion)
      ? await this.research.research(message.text ?? "", this.config.tavilyMaxResults)
      : undefined;
    if (plan.needsWeb || currentQuestion) {
      plan = { ...plan, needsWeb: true };
    }
    if (plan.decision === "SEND_IMAGE" && (!plan.mediaUrl || !isSafeHttpsUrl(plan.mediaUrl) || !messageContainsUrl(message.text, plan.mediaUrl))) {
      const mediaQuery = plan.mediaQuery ?? mediaSearchQuery(message.text ?? message.media?.caption ?? "");
      const media = await this.research.searchMedia(mediaQuery, this.config.tavilyMaxResults);
      const candidate = media[0];
      if (candidate) {
        plan = { ...plan, mediaUrl: candidate.url, mediaMimeType: candidate.mimeType ?? "image/jpeg", needsMedia: true };
        await this.log("media.search_succeeded", "info", { query: mediaQuery, providerUrl: candidate.url }, message);
      } else {
        plan = {
          ...plan,
          decision: "REPLY",
          text: "I couldn't find a safe image for that request.",
          mediaUrl: undefined,
          mediaMimeType: undefined,
          needsMedia: false,
        };
        await this.log("media.search_failed", "warn", { query: mediaQuery }, message);
      }
    }
    if (plan.decision !== "IGNORE" && !plan.text && !["REACT", "SEND_IMAGE", "SEND_AUDIO"].includes(plan.decision)) {
      const input: ProviderInput = {
        messageText: message.text ?? message.media?.caption ?? "",
        messageType: message.type,
        ...(message.senderName ? { senderName: message.senderName } : {}),
        directed: result.local.directed,
        ...(message.transcriptConfidence !== undefined ? { transcriptConfidence: message.transcriptConfidence } : {}),
        ...(message.transcriptLanguage ? { transcriptLanguage: message.transcriptLanguage } : {}),
        context,
        ...(evidence ? { evidence } : {}),
      };
      const response = await this.providers.generateResponse(input, message.groupId);
      if (response) plan = { ...plan, text: response };
    }
    if (this.shouldUseAudioReply(message) && plan.text && plan.decision !== "REACT" && plan.decision !== "IGNORE") {
      try {
        const audio = await this.media.synthesizeSpeech(plan.text);
        const audioPlan = { ...plan, decision: "SEND_AUDIO" as const, text: undefined, mediaUrl: undefined, mediaMimeType: audio.mimeType };
        const result = await this.actions.execute(audioPlan, message, group, audio);
        if (result.reason === "sent" || result.reason === "transport_failure") return;
      } catch (error) {
        await this.log("media.tts_failed", "warn", { error: error instanceof Error ? error.message : "unknown" }, message);
      }
    }
    await this.actions.execute(plan, message, group);
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : "inbound processing failed";
      const attempts = this.store.inboundJobByMessageId(initialMessage.id)?.attempts ?? job.attempts;
      await this.store.updateInboundJob(job.id, { status: "FAILED", attempts, lastError: message, nextAttemptAt: attempts < 3 ? Date.now() + 500 : undefined });
      await this.log("message.processing_failed", "error", { error: message, attempts }, initialMessage);
      throw error;
    } finally {
      if (typing && this.transport.sendTyping) await this.transport.sendTyping(initialMessage.chatId, false).catch(() => undefined);
      if (!failed) await this.store.updateInboundJob(job.id, { status: "COMPLETED", nextAttemptAt: undefined, lastError: undefined });
    }
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
        ...(current?.participationOverride ? { participationOverride: current.participationOverride } : {}),
        lastSeenAt: Date.now(),
      };
      await this.store.upsertGroup(group);
    }
    await this.log("groups.synced", "info", { count: groups.length });
    await this.drainInboundJobs();
  }

  async setDirectMessageAllowlist(contacts: string[]): Promise<string[]> {
    const allowlist = [...new Set(contacts.map((contact) => contact.trim()).filter(Boolean))];
    this.config.directMessageAllowlist = allowlist;
    await this.store.updateSettings({ directMessageAllowlist: allowlist });
    await this.log("dm_allowlist.changed", "info", { count: allowlist.length });
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

  async setGroupParticipation(id: string, participation: Partial<ParticipationSettings>): Promise<GroupRecord | undefined> {
    const group = await this.store.updateGroup(id, { participationOverride: participation });
    if (group) await this.log("group.participation_changed", "info", { fields: Object.keys(participation) }, undefined, id);
    return group;
  }

  async setParticipation(participation: ParticipationSettings): Promise<ParticipationSettings> {
    this.config.participation = { ...this.config.participation, ...participation };
    this.config.groupCooldownMs = this.config.participation.groupCooldownMs;
    await this.store.updateSettings({ participation: this.config.participation });
    await this.log("participation.changed", "info", { fields: Object.keys(participation) });
    return this.config.participation;
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

  async listBackups() {
    return this.backups.list();
  }

  async createBackup() {
    return this.backups.create();
  }

  async setControls(update: { outboundPaused?: boolean; aiProcessingPaused?: boolean }): Promise<void> {
    if (update.outboundPaused !== undefined) this.config.outboundPaused = update.outboundPaused;
    if (update.aiProcessingPaused !== undefined) this.config.aiProcessingPaused = update.aiProcessingPaused;
    await this.store.updateSettings({
      ...(update.outboundPaused !== undefined ? { outboundPaused: update.outboundPaused } : {}),
      ...(update.aiProcessingPaused !== undefined ? { aiProcessingPaused: update.aiProcessingPaused } : {}),
    });
    await this.log("controls.changed", "info", {
      outboundPaused: this.config.outboundPaused,
      aiProcessingPaused: this.config.aiProcessingPaused,
    });
  }

  dashboardState(): Record<string, unknown> {
    const snapshot = this.store.snapshot;
    return {
      connection: snapshot.runtime,
      time: { timeZone: NIGERIA_TIME_ZONE, current: formatNigeriaDateTime() },
      safety: {
        groupOnlyMode: this.config.groupOnlyMode,
        directMessageAllowlist: this.config.directMessageAllowlist,
        outboundPaused: this.config.outboundPaused,
        aiProcessingPaused: this.config.aiProcessingPaused,
        dryRun: this.config.dryRun,
        quietHoursStart: this.config.quietHoursStart,
        quietHoursEnd: this.config.quietHoursEnd,
        audioReplyMode: this.config.audioReplyMode,
        maxMediaBytes: this.config.maxMediaBytes,
        maxVideoDurationSeconds: this.config.maxVideoDurationSeconds,
        mediaDownloadsPerHour: this.config.mediaDownloadsPerHour,
      },
      participation: this.config.participation,
      diagnostics: this.lastDecisionDiagnostics,
      groups: this.store.groups(),
      groupActivity: Object.fromEntries(this.store.groups().map((group) => [group.id, groupActivityState(this.store, group.id, groupParticipation(group, this.config.participation))])),
      metrics: snapshot.runtime.metrics,
      providers: this.providers.statuses(),
      media: this.media.health(),
      research: { tavilyAvailable: Boolean(this.config.tavilyApiKey) },
      queue: this.transport.queueStats?.() ?? { pending: 0, processing: 0, failed: 0 },
      outboundQueue: this.actions.queueStats(),
      workers: {
        whatsapp: { running: Boolean(this.transport.connected), queue: this.transport.queueStats?.() ?? { pending: 0, processing: 0, failed: 0 } },
        outbound: this.actions.health(),
        tasks: this.tasks.health(),
        backups: this.backups.health(),
      },
      inboundQueue: this.inboundQueue.stats(),
      recentLogs: this.store.logs(30),
      recentActions: this.store.actions(30),
      tasks: this.store.tasks().slice(0, 100),
    };
  }

  health(): { status: "ok" | "degraded"; connection: string; ready: boolean; workers: Record<string, unknown> } {
    const dashboard = this.dashboardState();
    const connection = (dashboard.connection as { connectionStatus?: string }).connectionStatus ?? "DISCONNECTED";
    return { status: connection === "CONNECTED" ? "ok" : "degraded", connection, ready: connection === "CONNECTED", workers: dashboard.workers as Record<string, unknown> };
  }

  private personality(group: GroupRecord) {
    return { ...this.config.personality, ...(group.personalityOverride ?? {}) };
  }

  private async drainInboundJobs(): Promise<void> {
    if (!this.transport.connected) return;
    for (const job of this.store.inboundJobs().filter((item) => (item.status === "PENDING" || item.status === "FAILED") && item.attempts < 3)) {
      await this.inboundQueue.enqueueAndWait(job.chatId, () => this.processInboundMessage(job.message)).catch(() => undefined);
    }
  }

  private shouldUseAudioReply(message: CanonicalMessage): boolean {
    return this.config.audioReplyMode === "always" || (this.config.audioReplyMode === "adaptive" && message.type === "audio");
  }

  private async executeTaskResult(result: { reply?: string }, message: CanonicalMessage, group?: GroupRecord): Promise<void> {
    if (!result.reply) return;
    await this.actions.execute({ decision: "REPLY_QUOTED", confidence: 1, reason: "task_command", targetMessageId: message.id, text: result.reply, delayMs: 0, needsWeb: false, needsMedia: false, priority: "CRITICAL", bypassCooldown: true, responseStyle: "short_casual" }, message, group);
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

function isTextDocument(mimeType?: string): boolean {
  const normalized = mimeType?.toLowerCase();
  return Boolean(normalized?.startsWith("text/") || ["application/json", "application/xml", "application/javascript"].includes(normalized ?? ""));
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mediaSearchQuery(value: string): string {
  return value
    .replace(/\b(?:please\s+)?(?:send|show|find|get|search|look\s+up)\s+(?:me\s+)?/gi, "")
    .replace(/\b(?:a|an|the)\s+(?:picture|image|photo|meme|gif)\s+(?:of|about)\s+/gi, "")
    .replace(/\b(?:picture|image|photo|meme|gif)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300) || value.trim().slice(0, 300);
}

function messageContainsUrl(text: string | undefined, candidate: string): boolean {
  return Boolean(text && [...text.matchAll(/https:\/\/[^\s<>]+/gi)].some((match) => match[0] === candidate));
}
