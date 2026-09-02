import { randomUUID } from "node:crypto";
import type { WAMessage } from "@whiskeysockets/baileys";
import { ActionService, type OutboundTransport } from "./actions.js";
import { DecisionEngine, isLinkAnalysisRequestText } from "./decision.js";
import type { AppConfig, CanonicalMessage, GroupRecord, InboundJobRecord, LanguagePreference, Personality, TaskRecord } from "./types.js";
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
import { extractHttpsUrls, isSafeHttpsUrl } from "./network.js";
import { GeminiEmbeddingProvider, QdrantVectorMemoryProvider } from "./vector-memory.js";
import { MemoryVectorWorker } from "./memory-vector-worker.js";
import { applyLanguagePreference, languageLabel, migrateLegacyPersonality, parseLanguageCommand, parseLanguageTask, previewPersonality, resolvePersonality } from "./persona.js";
import { createCoreSkillRegistry, SkillRegistry } from "./skills.js";
import { ElevenLabsWhatsAppCallService, parseVoiceCallCommand } from "./voice.js";
import { normalizeLanguageName } from "./languages.js";
import { formatMusicRecommendation } from "./music.js";

export class BotRuntime {
  readonly memory: MemoryService;
  readonly providers: ProviderRouter;
  readonly research: ResearchService;
  readonly decisions: DecisionEngine;
  readonly actions: ActionService;
  readonly tasks: TaskService;
  readonly media: MediaProcessor;
  readonly backups: BackupService;
  readonly memoryVector: MemoryVectorWorker;
  readonly skills: SkillRegistry;
  readonly voiceCalls: ElevenLabsWhatsAppCallService;
  private readonly inboundQueue = new KeyedJobQueue(4);
  private readonly personaCache = new Map<string, Personality>();
  private lastDecisionDiagnostics?: Record<string, unknown>;
  private memoryMaintenanceTimer?: ReturnType<typeof setInterval>;

  constructor(
    readonly store: Store,
    readonly config: AppConfig,
    private readonly transport: OutboundTransport,
  ) {
    const embedding = config.embeddingProvider === "gemini" ? new GeminiEmbeddingProvider(config.geminiApiKey, config.embeddingModel, config.embeddingDimensions) : undefined;
    const vector = new QdrantVectorMemoryProvider(config.qdrantUrl, config.qdrantApiKey, config.qdrantCollection, config.embeddingDimensions);
    this.memoryVector = new MemoryVectorWorker(store, embedding, vector);
    this.memory = new MemoryService(
      store,
      (memory) => this.memoryVector.enqueue(memory),
      (query, scopeId, limit) => this.memoryVector.retrieve(query, scopeId, limit),
      {
        recentMessageLimit: config.memoryRecentMessageLimit,
        groupMemoryLimit: config.memoryGroupLimit,
        memberMemoryLimit: config.memoryMemberLimit,
        semanticMemoryLimit: config.memorySemanticLimit,
        staleAfterDays: config.memoryStaleAfterDays,
        archiveAfterDays: config.memoryArchiveAfterDays,
      },
      (memoryId) => this.memoryVector.enqueueDeletion(memoryId),
    );
    this.providers = new ProviderRouter(store, config);
    this.research = new ResearchService(store, [new TavilyProvider(config.tavilyApiKey), new DuckDuckGoProvider()], [new DuckDuckGoImageProvider(), new WikimediaImageProvider()], (memory) => this.memoryVector.enqueue(memory));
    this.decisions = new DecisionEngine(this.providers);
    this.skills = createCoreSkillRegistry();
    this.actions = new ActionService(store, config, transport);
    this.tasks = new TaskService(store, config, transport);
    this.media = new MediaProcessor(new FallbackSpeechToTextProvider([new GroqSpeechToTextProvider(config.groqApiKey), new ElevenLabsSpeechToTextProvider(config.elevenLabsApiKey, "scribe_v1", config.elevenLabsApiBaseUrl)]), new GeminiVisionProvider(config.geminiApiKey, config.geminiModel), new FallbackTextToSpeechProvider([new ElevenLabsTextToSpeechProvider(config.elevenLabsApiKey, config.elevenLabsVoiceId, config.elevenLabsTtsModel, config.elevenLabsApiBaseUrl), new OpenAITextToSpeechProvider(config.ttsApiKey, config.ttsBaseUrl, config.ttsModel, config.ttsVoice)]), config.mediaDownloadsPerHour);
    this.voiceCalls = new ElevenLabsWhatsAppCallService({
      apiKey: config.elevenLabsApiKey,
      agentId: config.elevenLabsAgentId,
      apiBaseUrl: config.elevenLabsApiBaseUrl,
      whatsappPhoneNumberId: config.elevenLabsWhatsAppPhoneNumberId,
      permissionTemplateName: config.elevenLabsWhatsAppCallPermissionTemplateName,
      permissionTemplateLanguageCode: config.elevenLabsWhatsAppCallPermissionTemplateLanguageCode,
    });
    this.backups = new BackupService(store, config.dataDir, config.backupIntervalHours, config.backupRetentionCount);
  }

  async init(): Promise<void> {
    await this.store.init();
    const pruned = await this.store.pruneExpired(this.config.messageRetentionDays);
    if (Object.values(pruned).some((count) => count > 0)) await this.log("retention.pruned", "info", { ...pruned });
    const settings = this.store.settings();
    const storedPersonality = settings?.languagePreferenceConfigured
      ? settings.personality
      : migrateLegacyPersonality(settings?.personality);
    if (storedPersonality) {
      this.config.personality = resolvePersonality(this.config.personality, storedPersonality);
      if (storedPersonality !== settings?.personality || !settings?.languagePreferenceConfigured) {
        await this.store.updateSettings({ personality: storedPersonality, languagePreferenceConfigured: true });
      }
    }
    if (settings?.outboundPaused !== undefined) this.config.outboundPaused = settings.outboundPaused;
    if (settings?.aiProcessingPaused !== undefined) this.config.aiProcessingPaused = settings.aiProcessingPaused;
    if (settings?.directMessageAllowlist !== undefined) this.config.directMessageAllowlist = [...settings.directMessageAllowlist];
    if (settings?.participation) this.config.participation = { ...this.config.participation, ...settings.participation };
    for (const [skillId, enabled] of Object.entries(settings?.skillOverrides ?? {})) {
      if (this.skills.get(skillId)) this.skills.setEnabled(skillId, enabled);
    }
    this.personaCache.clear();
    this.config.groupCooldownMs = this.config.participation.groupCooldownMs;
    if (!settings) {
      await this.store.updateSettings({ outboundPaused: this.config.outboundPaused, aiProcessingPaused: this.config.aiProcessingPaused, directMessageAllowlist: this.config.directMessageAllowlist, personality: this.config.personality, languagePreferenceConfigured: true, participation: this.config.participation });
    } else if (!settings.languagePreferenceConfigured && !storedPersonality) {
      await this.store.updateSettings({ languagePreferenceConfigured: true });
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
    this.memoryVector.start();
    if (!this.memoryMaintenanceTimer) {
      this.memoryMaintenanceTimer = setInterval(() => void this.memory.maintain().catch((error) => this.log("memory.maintenance_failed", "warn", { error: error instanceof Error ? error.message : "unknown" })), 15 * 60_000);
      void this.memory.maintain().catch((error) => void this.log("memory.maintenance_failed", "warn", { error: error instanceof Error ? error.message : "unknown" }));
    }
    void this.drainInboundJobs();
  }

  async stopBackgroundWorkers(): Promise<void> {
    if (this.memoryMaintenanceTimer) clearInterval(this.memoryMaintenanceTimer);
    this.memoryMaintenanceTimer = undefined;
    this.tasks.stop();
    await this.memoryVector.stop();
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
    if (!message.isGroup) {
      const languageCommand = parseLanguageCommand(message.text ?? "");
      if (languageCommand) {
        const current = this.dmLanguagePreference(message.chatId);
        const reply = languageCommand === "help"
          ? `Your saved reply language is ${current}. Use "language english", "language pidgin", "language yoruba", "language igbo", "language hausa", "language french", "language spanish", "language chinese", "language mixed", or "language auto" to change it.`
          : await this.saveDmLanguagePreference(message.chatId, languageCommand);
        await this.executeTaskResult({ reply }, message, group);
        return;
      }
    }
    const contextGroup = group ?? directMessageContext(message.chatId);
    const personality = this.personality(contextGroup, message.isGroup ? undefined : this.dmLanguagePreference(message.chatId));
    if (personality.memoryEnabled) await this.memory.observe(message);
    const context = personality.memoryEnabled
      ? await this.memory.contextWithSemantic(contextGroup, message.senderId, personality, message.text ?? message.media?.caption ?? "", message.id)
      : { ...this.memory.context(contextGroup, message.senderId, personality, "", message.id), memories: [], member: undefined };
    context.skillHints = this.skills.discover(message.text ?? "").slice(0, 8).map(({ skillId, name, description, category, scope, skillFile }) => ({ skillId, name, description, category, scope, ...(skillFile ? { skillFile } : {}) }));
    const languageTask = parseLanguageTask(message.text ?? "");
    if (languageTask && (!message.isGroup || message.text?.toLowerCase().includes(this.config.botName.toLowerCase()))) {
      const taskText = languageTask.text || message.text || "";
      const response = await this.providers.generateResponse({
        messageText: taskText,
        messageType: message.type,
        directed: true,
        ...(message.senderName ? { senderName: message.senderName } : {}),
        context,
        task: languageTask.kind,
        ...(languageTask.targetLanguage ? { targetLanguage: languageLabel(languageTask.targetLanguage) } : { targetLanguage: languageLabel(personality.languageMix) }),
      }, message.groupId ?? message.chatId);
      await this.executeTaskResult({ reply: response ?? "I couldn't complete that language task right now." }, message, group);
      return;
    }
    if (!message.isGroup && parseVoiceCallCommand(message.text ?? "")) {
      try {
        if (this.config.dryRun) {
          await this.log("voice.call_skipped", "info", { reason: "dry_run" }, message);
          return;
        }
        if (this.config.outboundPaused) {
          await this.log("voice.call_skipped", "info", { reason: "outbound_paused" }, message);
          return;
        }
        const recipient = callRecipient(message);
        const result = await this.voiceCalls.startCall(recipient);
        await this.log("voice.call_started", "info", { conversationId: result.conversationId ?? "unknown" }, message);
        await this.executeTaskResult({ reply: "I have started the ElevenLabs WhatsApp voice call request." }, message, group);
      } catch (error) {
        await this.log("voice.call_failed", "warn", { error: error instanceof Error ? error.message : "unknown" }, message);
        await this.executeTaskResult({ reply: "Voice calling is not ready yet. Please configure the ElevenLabs WhatsApp call settings." }, message, group);
      }
      return;
    }
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
    const musicReply = formatMusicRecommendation(message.text ?? "");
    if (musicReply) {
      await this.executeTaskResult({ reply: musicReply }, message, group);
      return;
    }
    const result = await this.decisions.decide(message, contextGroup, context, { ...this.config, botName: personality.displayName, alwaysReplyToAllowedDm: !message.isGroup });
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
    const linkAnalysis = isLinkAnalysisRequestText(message.text ?? "");
    this.lastDecisionDiagnostics = { ...this.lastDecisionDiagnostics, searchRequired: Boolean(plan.needsWeb || currentQuestion || linkAnalysis), mediaSearchRequired: ["SEND_IMAGE", "SEND_STICKER"].includes(plan.decision) };
    const evidence = plan.decision !== "IGNORE" && personality.webSearchEnabled && (plan.needsWeb || currentQuestion || linkAnalysis)
      ? await this.research.research(message.text ?? "", this.config.tavilyMaxResults)
      : undefined;
    if (plan.needsWeb || currentQuestion || linkAnalysis) {
      plan = { ...plan, needsWeb: true };
    }
    if (["SEND_IMAGE", "SEND_STICKER"].includes(plan.decision) && (!plan.mediaUrl || !isSafeHttpsUrl(plan.mediaUrl) || !messageContainsUrl(message.text, plan.mediaUrl))) {
      const sticker = plan.decision === "SEND_STICKER";
      const mediaQuery = `${plan.mediaQuery ?? mediaSearchQuery(message.text ?? message.media?.caption ?? "")}${sticker ? " sticker webp" : ""}`;
      const explicitStickerUrl = sticker ? extractHttpsUrls(message.text ?? "").find((url) => /\.webp(?:[?#]|$)/i.test(url)) : undefined;
      const media = explicitStickerUrl ? [] : await this.research.searchMedia(mediaQuery, this.config.tavilyMaxResults);
      const candidate = explicitStickerUrl
        ? { url: explicitStickerUrl, mimeType: "image/webp" }
        : sticker ? media.find((item) => item.mimeType === "image/webp" || /\.webp(?:[?#]|$)/i.test(item.url)) : media[0];
      if (candidate) {
        plan = { ...plan, mediaUrl: candidate.url, mediaMimeType: sticker ? "image/webp" : candidate.mimeType ?? "image/jpeg", needsMedia: true };
        await this.log(sticker ? "sticker.search_succeeded" : "media.search_succeeded", "info", { query: mediaQuery, providerUrl: candidate.url }, message);
      } else {
        plan = {
          ...plan,
          decision: "REPLY",
          text: sticker ? "I couldn't find a safe sticker for that request." : "I couldn't find a safe image for that request.",
          mediaUrl: undefined,
          mediaMimeType: undefined,
          needsMedia: false,
        };
        await this.log("media.search_failed", "warn", { query: mediaQuery }, message);
      }
    }
    if (plan.decision !== "IGNORE" && !["REACT", "SEND_IMAGE", "SEND_STICKER"].includes(plan.decision) && (!plan.text || Boolean(evidence))) {
      const input: ProviderInput = {
        messageText: message.text ?? message.media?.caption ?? "",
        messageType: message.type,
        ...(message.senderName ? { senderName: message.senderName } : {}),
        directed: result.local.directed,
        ...(message.transcriptConfidence !== undefined ? { transcriptConfidence: message.transcriptConfidence } : {}),
        ...(message.transcriptLanguage ? { transcriptLanguage: message.transcriptLanguage } : {}),
        context,
        ...(evidence ? { evidence } : {}),
        ...(linkAnalysis ? { task: "analyze" as const } : {}),
      };
      const response = await this.providers.generateResponse(input, message.groupId);
      if (response) plan = { ...plan, text: response };
    }
    if ((plan.decision === "SEND_AUDIO" || this.shouldUseAudioReply(message, personality)) && plan.text && plan.decision !== "REACT" && plan.decision !== "IGNORE") {
      try {
        const audio = await this.media.synthesizeSpeech(plan.text);
        const audioPlan = { ...plan, decision: "SEND_AUDIO" as const, text: undefined, mediaUrl: undefined, mediaMimeType: audio.mimeType };
        const result = await this.actions.execute(audioPlan, message, group, audio);
        if (result.reason === "sent") return;
        await this.log("media.audio_send_failed", "warn", { reason: result.reason }, message);
      } catch (error) {
        await this.log("media.tts_failed", "warn", { error: error instanceof Error ? error.message : "unknown" }, message);
      }
      if (plan.decision === "SEND_AUDIO") {
        plan = { ...plan, decision: "REPLY", reason: "audio_fallback_text", text: plan.text || "I couldn't send a voice note right now, so I'll reply in text.", mediaUrl: undefined, mediaMimeType: undefined, needsMedia: false };
      }
    } else if (plan.decision === "SEND_AUDIO") {
      plan = { ...plan, decision: "REPLY", reason: "audio_fallback_text", text: plan.text || "I couldn't send a voice note right now, so I'll reply in text.", mediaUrl: undefined, mediaMimeType: undefined, needsMedia: false };
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
        learningEnabled: current?.learningEnabled ?? true,
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

  async setGroupLearning(id: string, learningEnabled: boolean): Promise<GroupRecord | undefined> {
    const group = await this.store.updateGroup(id, { learningEnabled });
    if (group) await this.log("group.learning_changed", "info", { learningEnabled }, undefined, id);
    return group;
  }

  async setGroupPersonality(id: string, personality: Partial<AppConfig["personality"]>): Promise<GroupRecord | undefined> {
    const current = this.store.group(id);
    if (!current) return undefined;
    const merged = { ...(current.personalityOverride ?? {}), ...personality };
    const group = await this.store.updateGroup(id, { personalityOverride: merged });
    this.personaCache.delete(id);
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
    this.config.personality = resolvePersonality(this.config.personality, personality);
    this.personaCache.clear();
    await this.store.updateSettings({ personality: this.config.personality, ...(personality.languageMix === undefined ? {} : { languagePreferenceConfigured: true }) });
    await this.log("personality.changed", "info", { fields: Object.keys(personality) });
  }

  personalityForGroup(groupId?: string): Personality {
    if (!groupId) return this.config.personality;
    return this.personality(this.store.group(groupId) ?? directMessageContext(groupId));
  }

  personalityForDm(chatId: string): Personality {
    return this.personality(directMessageContext(chatId), this.dmLanguagePreference(chatId));
  }

  previewPersona(message: string, groupId?: string): string {
    return previewPersonality(message, this.personalityForGroup(groupId));
  }

  async setSkillEnabled(skillId: string, enabled: boolean): Promise<void> {
    this.skills.setEnabled(skillId, enabled);
    await this.store.updateSettings({ skillOverrides: { ...(this.store.settings()?.skillOverrides ?? {}), [skillId]: enabled } });
    await this.log("skill.configuration_changed", "info", { skillId, enabled });
  }

  dmLanguagePreference(chatId: string): LanguagePreference {
    const preference = this.store.settings()?.dmLanguagePreferences?.[chatId];
    return normalizeLanguageName(preference) as LanguagePreference | undefined ?? "english";
  }

  async saveDmLanguagePreference(chatId: string, preference: LanguagePreference): Promise<string> {
    const normalized = normalizeLanguageName(preference) as LanguagePreference | undefined ?? "english";
    const preferences = { ...(this.store.settings()?.dmLanguagePreferences ?? {}), [chatId]: normalized };
    await this.store.updateSettings({ dmLanguagePreferences: preferences });
    this.personaCache.delete(chatId);
    await this.log("dm.language_changed", "info", { chatId, preference: normalized });
    if (normalized === "english") return "English is now your saved reply language. I will use standard English and avoid Nigerian Pidgin unless you ask for it.";
    return `${languageLabel(normalized)} is now your saved reply language.`;
  }

  async resetMemory(scopeId: string): Promise<number> {
    const count = await this.store.deleteMemories(scopeId);
    await this.log("memory.deleted", "info", { scopeId, count });
    return count;
  }

  async deleteMemory(id: string): Promise<boolean> {
    const deleted = await this.store.deleteMemory(id);
    if (deleted) await this.log("memory.deleted", "info", { memoryId: id, count: 1 });
    return deleted;
  }

  async deleteAllMemories(): Promise<number> {
    const count = await this.store.deleteAllMemories();
    await this.log("memory.deleted_all", "info", { count });
    return count;
  }

  async rebuildMemoryVectors(scopeId?: string): Promise<{ requested: number; enabled: boolean; queue: Record<string, unknown> }> {
    const memories = scopeId ? this.store.memories(scopeId) : this.store.memories();
    for (const memory of memories) await this.memoryVector.enqueue(memory, true);
    return { requested: memories.length, enabled: this.memoryVector.enabled, queue: this.memoryVector.health().queue as Record<string, unknown> };
  }

  memoryExport(scopeId?: string): { exportedAt: number; scopeId?: string; memories: ReturnType<Store["memories"]> } {
    const memories = scopeId ? this.store.memories(scopeId) : this.store.memories();
    return { exportedAt: Date.now(), ...(scopeId ? { scopeId } : {}), memories };
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
    const memories = Object.values(snapshot.memories);
    const memoryVector = this.memoryVector.health();
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
      personality: this.config.personality,
      skills: this.skills.list(),
      diagnostics: this.lastDecisionDiagnostics,
      groups: this.store.groups(),
      groupActivity: Object.fromEntries(this.store.groups().map((group) => [group.id, groupActivityState(this.store, group.id, groupParticipation(group, this.config.participation))])),
      metrics: snapshot.runtime.metrics,
      providers: this.providers.statuses(),
      media: { ...this.media.health(), elevenLabsWhatsAppCalling: this.voiceCalls.available },
      research: { tavilyAvailable: Boolean(this.config.tavilyApiKey) },
      memory: {
        totalMessages: Object.keys(snapshot.messages).length,
        storedMemories: memories.length,
        activeMemories: memories.filter((memory) => memory.status === "ACTIVE").length,
        archivedMemories: memories.filter((memory) => memory.status === "ARCHIVED").length,
        groups: Object.keys(snapshot.groups).length,
        members: Object.keys(snapshot.members).length,
        queue: memoryVector.queue,
        vectorDatabase: { name: memoryVector.vectorProvider, enabled: memoryVector.enabled, ready: memoryVector.collectionReady && memoryVector.providerHealthy, providerHealthy: memoryVector.providerHealthy },
        embeddingProvider: { name: memoryVector.embeddingProvider, enabled: memoryVector.embeddingAvailable },
      },
      queue: this.transport.queueStats?.() ?? { pending: 0, processing: 0, failed: 0 },
      outboundQueue: this.actions.queueStats(),
      workers: {
        whatsapp: { running: Boolean(this.transport.connected), queue: this.transport.queueStats?.() ?? { pending: 0, processing: 0, failed: 0 } },
        outbound: this.actions.health(),
        tasks: this.tasks.health(),
        backups: this.backups.health(),
        memoryVector: this.memoryVector.health(),
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

  private personality(group: GroupRecord, languagePreference?: LanguagePreference) {
    const cached = this.personaCache.get(group.id);
    if (cached && (!languagePreference || cached.languageMix === languagePreference)) return cached;
    const resolved = resolvePersonality(this.config.personality, group.personalityOverride);
    const personalized = languagePreference ? applyLanguagePreference(resolved, languagePreference) : resolved;
    this.personaCache.set(group.id, personalized);
    return personalized;
  }

  private async drainInboundJobs(): Promise<void> {
    if (!this.transport.connected) return;
    for (const job of this.store.inboundJobs().filter((item) => (item.status === "PENDING" || item.status === "FAILED") && item.attempts < 3)) {
      await this.inboundQueue.enqueueAndWait(job.chatId, () => this.processInboundMessage(job.message)).catch(() => undefined);
    }
  }

  private shouldUseAudioReply(message: CanonicalMessage, personality = this.config.personality): boolean {
    return personality.voiceSkillsEnabled && (this.config.audioReplyMode === "always" || (this.config.audioReplyMode === "adaptive" && message.type === "audio"));
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
    learningEnabled: true,
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

function callRecipient(message: CanonicalMessage): string {
  const source = message.senderPhone ?? (message.senderId.endsWith("@s.whatsapp.net") ? message.senderId : undefined);
  const digits = source?.replace(/\D/g, "") ?? "";
  if (digits.length < 7) throw new Error("Unable to determine the WhatsApp call recipient");
  return digits;
}
