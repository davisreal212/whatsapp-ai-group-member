import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppConfig, CanonicalMessage, DecisionPlan, GroupRecord } from "./types.js";
import type { Store } from "./store.js";
import { isDirectMessageAllowed, isQuietHours } from "./policy.js";
import { isSafeHttpsUrl } from "./network.js";
import { KeyedJobQueue, type QueueStats } from "./queue.js";
import { groupActivityState, groupParticipation, type ActionPriority } from "./participation.js";
import { nigeriaDateParts, nigeriaLocalTimeToTimestamp } from "./time.js";

export interface OutboundTransport {
  readonly connected: boolean;
  queueStats?(): QueueStats;
  sendTyping?(chatId: string, typing: boolean): Promise<void>;
  sendText(groupId: string, text: string, quotedMessageId?: string, mentionedIds?: string[]): Promise<void>;
  sendTextToAll?(groupId: string, text: string, quotedMessageId?: string): Promise<void>;
  sendReaction(groupId: string, messageId: string, reaction: string): Promise<void>;
  sendMedia(groupId: string, mediaUrl: string, mimeType: string, caption?: string, quotedMessageId?: string): Promise<void>;
  sendSticker?(groupId: string, mediaUrl: string, quotedMessageId?: string): Promise<void>;
  sendAudioBuffer?(groupId: string, data: Buffer, mimeType: string, caption?: string, quotedMessageId?: string): Promise<void>;
}

const planSchema = z.object({
  decision: z.enum(["IGNORE", "REACT", "REPLY", "REPLY_QUOTED", "MENTION_REPLY", "SEND_IMAGE", "SEND_STICKER", "SEND_AUDIO"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(500),
  targetMessageId: z.string().min(1).max(200).optional(),
  reaction: z.string().min(1).max(8).optional(),
  text: z.string().max(2000).optional(),
  mediaUrl: z.string().url().optional(),
  mediaMimeType: z.string().max(100).optional(),
  delayMs: z.number().int().min(0).max(60_000),
  needsWeb: z.boolean(),
  needsMedia: z.boolean(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).optional(),
  bypassCooldown: z.boolean().optional(),
  mentionAll: z.boolean().optional(),
  responseStyle: z.enum(["short_casual", "helpful", "playful", "uncertain"]),
});

export interface ActionValidation {
  valid: boolean;
  reason: string;
  plan?: DecisionPlan;
}

export function validateActionPlan(
  plan: DecisionPlan,
  sourceMessage: CanonicalMessage,
  group: GroupRecord | undefined,
  store: Store,
  outboundPaused: boolean,
  groupOnlyMode = true,
  directMessageAllowlist: string[] = [],
  quietHoursStart = -1,
  quietHoursEnd = -1,
  allowGeneratedAudio = false,
  quietHoursEnabled = true,
): ActionValidation {
  const parsed = planSchema.safeParse(plan);
  if (!parsed.success) return { valid: false, reason: "malformed_action_plan" };
  if (plan.decision === "IGNORE") return { valid: true, reason: "ignore", plan };
  if (!sourceMessage.isGroup) {
    if (groupOnlyMode || !isDirectMessageAllowed(sourceMessage, directMessageAllowlist)) {
      return { valid: false, reason: "direct_message_not_allowlisted" };
    }
  } else {
    if (!sourceMessage.groupId || !group) return { valid: false, reason: "group_not_authorized" };
    if (!group.enabled || group.aiPaused) return { valid: false, reason: "group_not_enabled" };
  }
  if (outboundPaused) return { valid: false, reason: "outbound_paused" };
  if (isQuietHours(quietHoursStart, quietHoursEnd, new Date(), quietHoursEnabled)) return { valid: false, reason: "quiet_hours" };

  const targetId = plan.targetMessageId ?? sourceMessage.id;
  const target = store.message(targetId);
  if (!target || target.chatId !== sourceMessage.chatId || target.groupId !== sourceMessage.groupId) return { valid: false, reason: "target_not_in_group" };
  if (["REPLY", "REPLY_QUOTED", "MENTION_REPLY"].includes(plan.decision) && !plan.text) {
    return { valid: false, reason: "text_required" };
  }
  if (plan.decision === "REACT" && !plan.reaction) return { valid: false, reason: "reaction_required" };
  if (["SEND_IMAGE", "SEND_STICKER", "SEND_AUDIO"].includes(plan.decision)) {
    if (!(allowGeneratedAudio && plan.decision === "SEND_AUDIO") && (!plan.mediaUrl || !isSafeHttpsUrl(plan.mediaUrl))) return { valid: false, reason: "safe_media_url_required" };
    if (plan.mediaUrl && !isSafeHttpsUrl(plan.mediaUrl)) return { valid: false, reason: "safe_media_url_required" };
    if (plan.decision === "SEND_IMAGE" && plan.mediaMimeType && !plan.mediaMimeType.startsWith("image/")) return { valid: false, reason: "image_mime_required" };
    if (plan.decision === "SEND_STICKER" && plan.mediaMimeType !== "image/webp") return { valid: false, reason: "sticker_mime_required" };
    if (plan.decision === "SEND_AUDIO" && plan.mediaMimeType && !plan.mediaMimeType.startsWith("audio/")) return { valid: false, reason: "audio_mime_required" };
  }
  return { valid: true, reason: "validated", plan };
}

export class ActionService {
  private readonly queue = new KeyedJobQueue(2);
  // Admission is serialized per conversation before a cooldown check and insert.
  private readonly admissionQueue = new KeyedJobQueue(1);
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly latestIncoming = new Map<string, { id: string; timestamp: number }>();
  private started = false;
  private readonly generatedAudio = new Map<string, { data: Buffer; mimeType: string }>();

  constructor(
    private readonly store: Store,
    private readonly config: AppConfig,
    private readonly transport: OutboundTransport,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const action of this.store.actions(1000).filter((item) => item.status === "PENDING")) {
      void this.queue.enqueueAndWait(action.groupId, () => this.runPendingAction(action.id)).catch(() => undefined);
    }
  }

  async stop(): Promise<void> {
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    await this.queue.waitForIdle();
    this.started = false;
  }

  queueStats(): QueueStats {
    return this.queue.stats();
  }

  health(): { running: boolean; queue: QueueStats } {
    return { running: this.started, queue: this.queue.stats() };
  }

  noteIncoming(message: CanonicalMessage): void {
    const key = message.groupId ?? message.chatId;
    const current = this.latestIncoming.get(key);
    if (!current || message.timestamp >= current.timestamp) this.latestIncoming.set(key, { id: message.id, timestamp: message.timestamp });
    if (this.latestIncoming.size > 1_000) this.latestIncoming.delete(this.latestIncoming.keys().next().value as string);
  }

  async execute(plan: DecisionPlan, sourceMessage: CanonicalMessage, group: GroupRecord | undefined, generatedAudio?: { data: Buffer; mimeType: string }): Promise<ActionValidation> {
    const conversationId = sourceMessage.groupId ?? sourceMessage.chatId;
    let admission: { validation: ActionValidation; actionId?: string } | undefined;
    await this.admissionQueue.enqueueAndWait(conversationId, async () => {
      admission = await this.admit(plan, sourceMessage, group, conversationId, generatedAudio);
    });
    if (!admission) throw new Error("Action admission did not complete");
    if (!admission.validation.valid || plan.decision === "IGNORE") return admission.validation;
    await this.queue.enqueueAndWait(conversationId, () => this.runPendingAction(admission?.actionId as string));
    let completed = this.store.action(admission.actionId as string);
    if (generatedAudio && completed?.status === "PENDING") {
      await this.skipAction(admission.actionId as string, sourceMessage, plan, "generated_audio_send_failed");
      completed = this.store.action(admission.actionId as string);
    }
    if (completed?.status === "SENT") return { valid: true, reason: "sent", plan };
    if (completed?.status === "SKIPPED") return { valid: true, reason: completed.error ?? "skipped", plan };
    return { valid: false, reason: completed?.error ?? "transport_failure", plan };
  }

  private async admit(plan: DecisionPlan, sourceMessage: CanonicalMessage, group: GroupRecord | undefined, conversationId: string, generatedAudio?: { data: Buffer; mimeType: string }): Promise<{ validation: ActionValidation; actionId?: string }> {
    const hasGeneratedAudio = Boolean(generatedAudio);
    const validation = validateActionPlan(plan, sourceMessage, group, this.store, this.config.outboundPaused, this.config.groupOnlyMode, this.config.directMessageAllowlist, this.config.quietHoursStart, this.config.quietHoursEnd, hasGeneratedAudio, this.config.quietHoursEnabled);
    if (!validation.valid || plan.decision === "IGNORE") {
      await this.store.incrementMetric("actionsSkipped");
      await this.store.addLog({
        id: randomUUID(),
        event: validation.valid ? "action.ignored" : "action.rejected",
        level: validation.valid ? "info" : "warn",
        messageId: sourceMessage.id,
        ...(sourceMessage.groupId ? { groupId: sourceMessage.groupId } : {}),
        details: {
          decision: plan.decision,
          reason: validation.reason,
          chatId: sourceMessage.chatId,
          isGroup: sourceMessage.isGroup,
          targetMessageId: plan.targetMessageId ?? sourceMessage.id,
        },
        createdAt: Date.now(),
      });
      return { validation };
    }

    const idempotencyKey = `${conversationId}:${sourceMessage.id}:${plan.decision}`;
    const now = Date.now();
    const recentActions = this.store.actions(1000).filter((action) => action.groupId === conversationId);
    const today = nigeriaDateParts(now);
    const dayStart = nigeriaLocalTimeToTimestamp(today.year, today.month, today.day, 0, 0);
    if (sourceMessage.isGroup && this.config.dailyActionLimit > 0 && recentActions.filter((action) => action.scheduledFor >= dayStart && action.status === "SENT").length >= this.config.dailyActionLimit) {
      return { validation: await this.rejectRuntime(sourceMessage, plan, "daily_action_limit") };
    }
    if (recentActions.filter((action) => action.scheduledFor >= now - 60_000 && action.status === "SENT").length >= this.config.actionsPerMinute) {
      return { validation: await this.rejectRuntime(sourceMessage, plan, "minute_action_limit") };
    }
    if (recentActions.filter((action) => action.scheduledFor >= now - 3_600_000 && action.status === "SENT").length >= this.config.actionsPerHour) {
      return { validation: await this.rejectRuntime(sourceMessage, plan, "hour_action_limit") };
    }

    if (sourceMessage.isGroup && group) {
      const participation = groupParticipation(group, this.config.participation);
      const activity = groupActivityState(this.store, conversationId, participation, now);
      const priority = plan.priority ?? "NORMAL";
      const bypass = plan.bypassCooldown === true || priority === "HIGH" || priority === "CRITICAL";
      if (plan.mentionAll === true && activity.lastMentionAllAt !== undefined && now - activity.lastMentionAllAt < participation.groupMentionAllCooldownMs && priority !== "CRITICAL") {
        return { validation: await this.rejectRuntime(sourceMessage, plan, "mention_all_cooldown") };
      }
      if (!bypass && activity.cooldownUntil !== undefined && activity.cooldownUntil > now) {
        return { validation: await this.rejectRuntime(sourceMessage, plan, "group_cooldown") };
      }
      if (participation.adaptiveActivity && !bypass) {
        if (activity.activityLevel === "EXTREME") return { validation: await this.rejectRuntime(sourceMessage, plan, "extreme_activity") };
        if (activity.activityLevel === "HIGH" && priority === "LOW") return { validation: await this.rejectRuntime(sourceMessage, plan, "high_activity") };
      }
    }
    if (recentActions.some((action) => action.idempotencyKey === idempotencyKey)) {
      return { validation: await this.rejectRuntime(sourceMessage, plan, "duplicate_action") };
    }
    const normalizedText = plan.text?.trim().toLowerCase();
    if (normalizedText && recentActions.some((action) => action.status === "SENT" && action.actionType === plan.decision && now - (action.executedAt ?? action.scheduledFor) < 10 * 60_000 && typeof action.payload.text === "string" && action.payload.text.trim().toLowerCase() === normalizedText)) {
      return { validation: await this.rejectRuntime(sourceMessage, plan, "repetitive_response") };
    }

    const action = {
      id: randomUUID(),
      idempotencyKey,
      groupId: conversationId,
      sourceMessageId: sourceMessage.id,
      actionType: plan.decision,
      ...(plan.targetMessageId ? { targetMessageId: plan.targetMessageId } : {}),
      payload: { text: plan.text ?? "", reaction: plan.reaction ?? "", mediaUrl: plan.mediaUrl ?? "", mediaMimeType: plan.mediaMimeType ?? "", priority: plan.priority ?? "NORMAL", mentionAll: plan.mentionAll === true },
      scheduledFor: now + plan.delayMs,
      status: "PENDING" as const,
      attempts: 0,
    };
    if (hasGeneratedAudio && !this.transport.sendAudioBuffer) return { validation: await this.rejectRuntime(sourceMessage, plan, "audio_transport_unsupported") };
    if (!(await this.store.createAction(action))) return { validation: await this.rejectRuntime(sourceMessage, plan, "duplicate_action") };
    if (generatedAudio) this.generatedAudio.set(action.id, generatedAudio);
    return { validation: { valid: true, reason: "admitted", plan }, actionId: action.id };
  }

  private async runPendingAction(id: string): Promise<void> {
    const action = this.store.action(id);
    if (!action || action.status !== "PENDING") return;
    const sourceMessage = this.store.message(action.sourceMessageId);
    if (!sourceMessage) {
      await this.store.updateAction(id, { status: "FAILED", error: "source_message_missing" });
      await this.store.incrementMetric("actionFailures");
      await this.store.addLog({ id: randomUUID(), event: "action.recovery_failed", level: "error", details: { actionId: id, reason: "source_message_missing" }, createdAt: Date.now() });
      return;
    }
    if (sourceMessage.isGroup && this.hasNewerIncoming(sourceMessage)) {
      await this.skipAction(id, sourceMessage, planFromAction(action), "stale_conversation");
      return;
    }
    const group = sourceMessage.groupId ? this.store.group(sourceMessage.groupId) : undefined;
    const plan = planFromAction(action);
    const generatedAudio = this.generatedAudio.get(id);
    const validation = validateActionPlan(plan, sourceMessage, group, this.store, this.config.outboundPaused, this.config.groupOnlyMode, this.config.directMessageAllowlist, this.config.quietHoursStart, this.config.quietHoursEnd, Boolean(generatedAudio), this.config.quietHoursEnabled);
    if (!validation.valid) {
      await this.skipAction(id, sourceMessage, plan, validation.reason);
      return;
    }
    const unavailable = this.outboundSkipReason();
    if (unavailable) {
      await this.skipAction(id, sourceMessage, plan, unavailable);
      return;
    }
    const waitMs = action.scheduledFor - Date.now();
    if (waitMs > 0) await wait(waitMs);
    if (sourceMessage.isGroup && this.hasNewerIncoming(sourceMessage)) {
      await this.skipAction(id, sourceMessage, plan, "stale_conversation");
      return;
    }
    const delayedUnavailable = this.outboundSkipReason();
    if (delayedUnavailable) {
      await this.skipAction(id, sourceMessage, plan, delayedUnavailable);
      return;
    }
    const conversationId = sourceMessage.groupId ?? sourceMessage.chatId;
    const quotedMessageId = plan.targetMessageId ?? sourceMessage.id;
    try {
      if (plan.decision === "REACT") {
        await this.transport.sendReaction(conversationId, plan.targetMessageId ?? sourceMessage.id, plan.reaction as string);
      } else if (plan.decision === "SEND_STICKER") {
        if (!this.transport.sendSticker) throw new Error("sticker_transport_unsupported");
        await this.transport.sendSticker(conversationId, plan.mediaUrl as string, quotedMessageId);
      } else if (plan.decision === "SEND_IMAGE" || plan.decision === "SEND_AUDIO") {
        if (plan.decision === "SEND_AUDIO" && generatedAudio && this.transport.sendAudioBuffer) {
          await this.transport.sendAudioBuffer(conversationId, generatedAudio.data, generatedAudio.mimeType, undefined, quotedMessageId);
        } else {
          await this.transport.sendMedia(conversationId, plan.mediaUrl as string, plan.mediaMimeType ?? (plan.decision === "SEND_IMAGE" ? "image/jpeg" : "audio/ogg"), plan.text, quotedMessageId);
        }
      } else {
        if (plan.mentionAll && this.transport.sendTextToAll) {
          await this.transport.sendTextToAll(conversationId, plan.text as string, quotedMessageId);
        } else {
          await this.transport.sendText(conversationId, plan.text as string, ["REPLY", "REPLY_QUOTED", "MENTION_REPLY"].includes(plan.decision) ? quotedMessageId : undefined, plan.decision === "MENTION_REPLY" ? [sourceMessage.senderId] : undefined);
        }
      }
      await this.store.updateAction(id, { status: "SENT", executedAt: Date.now(), error: undefined, nextAttemptAt: undefined });
      await this.store.incrementMetric("actionsSent");
      await this.store.addLog({ id: randomUUID(), event: "action.sent", level: "info", messageId: sourceMessage.id, ...(sourceMessage.groupId ? { groupId: sourceMessage.groupId } : {}), details: { decision: plan.decision, targetMessageId: plan.targetMessageId ?? sourceMessage.id }, createdAt: Date.now() });
      this.generatedAudio.delete(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      const attempts = (action.attempts ?? 0) + 1;
      if (attempts < this.config.actionMaxAttempts) {
        const nextAttemptAt = Date.now() + Math.min(60_000, 1_000 * 2 ** (attempts - 1));
        await this.store.updateAction(id, { status: "PENDING", attempts, nextAttemptAt, scheduledFor: nextAttemptAt, error: message });
        await this.store.addLog({ id: randomUUID(), event: "action.retry_scheduled", level: "warn", messageId: sourceMessage.id, ...(sourceMessage.groupId ? { groupId: sourceMessage.groupId } : {}), details: { decision: plan.decision, attempts, nextAttemptAt }, createdAt: Date.now() });
        this.scheduleRetry(id, action.groupId, nextAttemptAt);
      } else {
        await this.store.updateAction(id, { status: "FAILED", attempts, error: message, nextAttemptAt: undefined });
        this.generatedAudio.delete(id);
        await this.store.incrementMetric("actionFailures");
        await this.store.addLog({ id: randomUUID(), event: "action.failed", level: "error", messageId: sourceMessage.id, ...(sourceMessage.groupId ? { groupId: sourceMessage.groupId } : {}), details: { decision: plan.decision, reason: "transport_failure", attempts }, createdAt: Date.now() });
      }
    }
  }

  private scheduleRetry(id: string, key: string, scheduledFor: number): void {
    if (this.retryTimers.has(id)) return;
    const timer = setTimeout(() => {
      this.retryTimers.delete(id);
      void this.queue.enqueueAndWait(key, () => this.runPendingAction(id)).catch(() => undefined);
    }, Math.max(0, scheduledFor - Date.now()));
    this.retryTimers.set(id, timer);
  }

  private async rejectRuntime(message: CanonicalMessage, plan: DecisionPlan, reason: string): Promise<ActionValidation> {
    await this.store.incrementMetric("actionsSkipped");
    await this.store.addLog({
      id: randomUUID(),
      event: "action.skipped",
      level: auditLevelForSkip(reason),
      messageId: message.id,
      ...(message.groupId ? { groupId: message.groupId } : {}),
      details: { decision: plan.decision, reason },
      createdAt: Date.now(),
    });
    return { valid: false, reason };
  }

  private outboundSkipReason(): "dry_run" | "outbound_paused" | "quiet_hours" | "transport_disconnected" | undefined {
    if (this.config.dryRun) return "dry_run";
    if (this.config.outboundPaused) return "outbound_paused";
    if (isQuietHours(this.config.quietHoursStart, this.config.quietHoursEnd, new Date(), this.config.quietHoursEnabled)) return "quiet_hours";
    if (!this.transport.connected) return "transport_disconnected";
    return undefined;
  }

  private hasNewerIncoming(message: CanonicalMessage): boolean {
    const latest = this.latestIncoming.get(message.groupId ?? message.chatId);
    return Boolean(latest && latest.id !== message.id && latest.timestamp >= message.timestamp);
  }

  private async skipAction(actionId: string, message: CanonicalMessage, plan: DecisionPlan, reason: string): Promise<ActionValidation> {
    this.generatedAudio.delete(actionId);
    await this.store.updateAction(actionId, { status: "SKIPPED", error: reason, nextAttemptAt: undefined });
    await this.store.incrementMetric("actionsSkipped");
    await this.store.addLog({
      id: randomUUID(),
      event: "action.skipped",
      level: auditLevelForSkip(reason),
      messageId: message.id,
      ...(message.groupId ? { groupId: message.groupId } : {}),
      details: { decision: plan.decision, reason },
      createdAt: Date.now(),
    });
    return { valid: true, reason, plan };
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function planFromAction(action: import("./types.js").ActionRecord): DecisionPlan {
  const payload = action.payload;
  const text = typeof payload.text === "string" ? payload.text : undefined;
  const reaction = typeof payload.reaction === "string" ? payload.reaction : undefined;
  const mediaUrl = typeof payload.mediaUrl === "string" ? payload.mediaUrl : undefined;
  const mediaMimeType = typeof payload.mediaMimeType === "string" ? payload.mediaMimeType : undefined;
  return {
    decision: action.actionType,
    confidence: 1,
    reason: "recovered_pending_action",
    ...(action.targetMessageId ? { targetMessageId: action.targetMessageId } : {}),
    ...(text ? { text } : {}),
    ...(reaction ? { reaction } : {}),
    ...(mediaUrl ? { mediaUrl } : {}),
    ...(mediaMimeType ? { mediaMimeType } : {}),
    ...(typeof payload.priority === "string" ? { priority: payload.priority as ActionPriority } : {}),
    ...(payload.mentionAll === true ? { mentionAll: true } : {}),
    ...(typeof payload.priority === "string" && ["HIGH", "CRITICAL"].includes(payload.priority) ? { bypassCooldown: true } : {}),
    delayMs: Math.max(0, action.scheduledFor - Date.now()),
    needsWeb: false,
    needsMedia: Boolean(mediaUrl),
    responseStyle: "short_casual",
  };
}

function auditLevelForSkip(reason: string): "info" | "warn" {
  return ["dry_run", "outbound_paused", "quiet_hours", "group_cooldown", "mention_all_cooldown", "high_activity", "extreme_activity", "duplicate_action", "repetitive_response"].includes(reason) ? "info" : "warn";
}
