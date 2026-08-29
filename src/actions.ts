import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppConfig, CanonicalMessage, DecisionPlan, GroupRecord } from "./types.js";
import type { Store } from "./store.js";
import { isDirectMessageAllowed } from "./policy.js";
import { isSafeHttpsUrl } from "./network.js";
import { KeyedJobQueue, type QueueStats } from "./queue.js";

export interface OutboundTransport {
  readonly connected: boolean;
  queueStats?(): QueueStats;
  sendText(groupId: string, text: string, quotedMessageId?: string, mentionedIds?: string[]): Promise<void>;
  sendReaction(groupId: string, messageId: string, reaction: string): Promise<void>;
  sendMedia(groupId: string, mediaUrl: string, mimeType: string, caption?: string): Promise<void>;
}

const planSchema = z.object({
  decision: z.enum(["IGNORE", "REACT", "REPLY", "REPLY_QUOTED", "MENTION_REPLY", "SEND_IMAGE", "SEND_AUDIO"]),
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

  const targetId = plan.targetMessageId ?? sourceMessage.id;
  const target = store.message(targetId);
  if (!target || target.chatId !== sourceMessage.chatId || target.groupId !== sourceMessage.groupId) return { valid: false, reason: "target_not_in_group" };
  if (["REPLY", "REPLY_QUOTED", "MENTION_REPLY"].includes(plan.decision) && !plan.text) {
    return { valid: false, reason: "text_required" };
  }
  if (plan.decision === "REACT" && !plan.reaction) return { valid: false, reason: "reaction_required" };
  if (["SEND_IMAGE", "SEND_AUDIO"].includes(plan.decision)) {
    if (!plan.mediaUrl || !isSafeHttpsUrl(plan.mediaUrl)) return { valid: false, reason: "safe_media_url_required" };
    if (plan.decision === "SEND_IMAGE" && plan.mediaMimeType && !plan.mediaMimeType.startsWith("image/")) return { valid: false, reason: "image_mime_required" };
    if (plan.decision === "SEND_AUDIO" && plan.mediaMimeType && !plan.mediaMimeType.startsWith("audio/")) return { valid: false, reason: "audio_mime_required" };
  }
  return { valid: true, reason: "validated", plan };
}

export class ActionService {
  private readonly queue = new KeyedJobQueue(2);
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private started = false;

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

  async execute(plan: DecisionPlan, sourceMessage: CanonicalMessage, group: GroupRecord | undefined): Promise<ActionValidation> {
    const validation = validateActionPlan(plan, sourceMessage, group, this.store, this.config.outboundPaused, this.config.groupOnlyMode, this.config.directMessageAllowlist);
    if (!validation.valid || plan.decision === "IGNORE") {
      await this.store.incrementMetric(validation.valid ? "actionsSkipped" : "actionsSkipped");
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
      return validation;
    }

    const conversationId = sourceMessage.groupId ?? sourceMessage.chatId;
    const idempotencyKey = `${conversationId}:${sourceMessage.id}:${plan.decision}`;
    const now = Date.now();
    const recentActions = this.store.actions(1000).filter((action) => action.groupId === conversationId);
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    if (recentActions.filter((action) => action.scheduledFor >= dayStart.getTime() && action.status === "SENT").length >= this.config.dailyActionLimit) {
      return this.rejectRuntime(sourceMessage, plan, "daily_action_limit");
    }
    if (recentActions.filter((action) => action.scheduledFor >= now - 60_000 && action.status === "SENT").length >= this.config.actionsPerMinute) {
      return this.rejectRuntime(sourceMessage, plan, "minute_action_limit");
    }
    if (recentActions.filter((action) => action.scheduledFor >= now - 3_600_000 && action.status === "SENT").length >= this.config.actionsPerHour) {
      return this.rejectRuntime(sourceMessage, plan, "hour_action_limit");
    }
    if (recentActions.some((action) => action.status === "SENT" && now - (action.executedAt ?? action.scheduledFor) < this.config.groupCooldownMs)) {
      return this.rejectRuntime(sourceMessage, plan, "group_cooldown");
    }

    const action = {
      id: randomUUID(),
      idempotencyKey,
      groupId: conversationId,
      sourceMessageId: sourceMessage.id,
      actionType: plan.decision,
      ...(plan.targetMessageId ? { targetMessageId: plan.targetMessageId } : {}),
      payload: { text: plan.text ?? "", reaction: plan.reaction ?? "", mediaUrl: plan.mediaUrl ?? "", mediaMimeType: plan.mediaMimeType ?? "" },
      scheduledFor: now + plan.delayMs,
      status: "PENDING" as const,
      attempts: 0,
    };
    if (!(await this.store.createAction(action))) return this.rejectRuntime(sourceMessage, plan, "duplicate_action");

    await this.queue.enqueueAndWait(conversationId, () => this.runPendingAction(action.id));
    const completed = this.store.action(action.id);
    if (completed?.status === "SENT") return { valid: true, reason: "sent", plan };
    if (completed?.status === "SKIPPED") return { valid: true, reason: completed.error ?? "skipped", plan };
    return { valid: false, reason: completed?.error ?? "transport_failure", plan };
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
    const group = sourceMessage.groupId ? this.store.group(sourceMessage.groupId) : undefined;
    const plan = planFromAction(action);
    const validation = validateActionPlan(plan, sourceMessage, group, this.store, this.config.outboundPaused, this.config.groupOnlyMode, this.config.directMessageAllowlist);
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
    const delayedUnavailable = this.outboundSkipReason();
    if (delayedUnavailable) {
      await this.skipAction(id, sourceMessage, plan, delayedUnavailable);
      return;
    }
    const conversationId = sourceMessage.groupId ?? sourceMessage.chatId;
    try {
      if (plan.decision === "REACT") {
        await this.transport.sendReaction(conversationId, plan.targetMessageId ?? sourceMessage.id, plan.reaction as string);
      } else if (plan.decision === "SEND_IMAGE" || plan.decision === "SEND_AUDIO") {
        await this.transport.sendMedia(conversationId, plan.mediaUrl as string, plan.mediaMimeType ?? (plan.decision === "SEND_IMAGE" ? "image/jpeg" : "audio/ogg"), plan.text);
      } else {
        await this.transport.sendText(conversationId, plan.text as string, ["REPLY_QUOTED", "MENTION_REPLY"].includes(plan.decision) ? plan.targetMessageId ?? sourceMessage.id : undefined, plan.decision === "MENTION_REPLY" ? [sourceMessage.senderId] : undefined);
      }
      await this.store.updateAction(id, { status: "SENT", executedAt: Date.now(), error: undefined, nextAttemptAt: undefined });
      await this.store.incrementMetric("actionsSent");
      await this.store.addLog({ id: randomUUID(), event: "action.sent", level: "info", messageId: sourceMessage.id, ...(sourceMessage.groupId ? { groupId: sourceMessage.groupId } : {}), details: { decision: plan.decision, targetMessageId: plan.targetMessageId ?? sourceMessage.id }, createdAt: Date.now() });
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
      level: "warn",
      messageId: message.id,
      ...(message.groupId ? { groupId: message.groupId } : {}),
      details: { decision: plan.decision, reason },
      createdAt: Date.now(),
    });
    return { valid: false, reason };
  }

  private outboundSkipReason(): "dry_run" | "outbound_paused" | "transport_disconnected" | undefined {
    if (this.config.dryRun) return "dry_run";
    if (this.config.outboundPaused) return "outbound_paused";
    if (!this.transport.connected) return "transport_disconnected";
    return undefined;
  }

  private async skipAction(actionId: string, message: CanonicalMessage, plan: DecisionPlan, reason: string): Promise<ActionValidation> {
    await this.store.updateAction(actionId, { status: "SKIPPED", error: reason, nextAttemptAt: undefined });
    await this.store.incrementMetric("actionsSkipped");
    await this.store.addLog({
      id: randomUUID(),
      event: "action.skipped",
      level: "warn",
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
    delayMs: Math.max(0, action.scheduledFor - Date.now()),
    needsWeb: false,
    needsMedia: Boolean(mediaUrl),
    responseStyle: "short_casual",
  };
}
