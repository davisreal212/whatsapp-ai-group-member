import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppConfig, CanonicalMessage, DecisionPlan, GroupRecord } from "./types.js";
import type { Store } from "./store.js";
import { isDirectMessageAllowed } from "./policy.js";
import { isSafeHttpsUrl } from "./network.js";
import type { QueueStats } from "./queue.js";

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
  constructor(
    private readonly store: Store,
    private readonly config: AppConfig,
    private readonly transport: OutboundTransport,
  ) {}

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
      payload: { text: plan.text ?? "", reaction: plan.reaction ?? "", mediaUrl: plan.mediaUrl ?? "" },
      scheduledFor: now + plan.delayMs,
      status: "PENDING" as const,
    };
    if (!(await this.store.createAction(action))) return this.rejectRuntime(sourceMessage, plan, "duplicate_action");

    const unavailable = this.outboundSkipReason();
    if (unavailable) return this.skipAction(action.id, sourceMessage, plan, unavailable);

    if (plan.delayMs > 0) await wait(plan.delayMs);
    const delayedUnavailable = this.outboundSkipReason();
    if (delayedUnavailable) return this.skipAction(action.id, sourceMessage, plan, delayedUnavailable);
    try {
      if (plan.decision === "REACT") {
        await this.transport.sendReaction(conversationId, plan.targetMessageId ?? sourceMessage.id, plan.reaction as string);
      } else if (plan.decision === "SEND_IMAGE" || plan.decision === "SEND_AUDIO") {
        await this.transport.sendMedia(conversationId, plan.mediaUrl as string, plan.mediaMimeType ?? (plan.decision === "SEND_IMAGE" ? "image/jpeg" : "audio/ogg"), plan.text);
      } else {
        await this.transport.sendText(conversationId, plan.text as string, ["REPLY_QUOTED", "MENTION_REPLY"].includes(plan.decision) ? plan.targetMessageId ?? sourceMessage.id : undefined, plan.decision === "MENTION_REPLY" ? [sourceMessage.senderId] : undefined);
      }
      await this.store.updateAction(action.id, { status: "SENT", executedAt: Date.now() });
      await this.store.incrementMetric("actionsSent");
      await this.store.addLog({
        id: randomUUID(),
        event: "action.sent",
        level: "info",
        messageId: sourceMessage.id,
        ...(sourceMessage.groupId ? { groupId: sourceMessage.groupId } : {}),
        details: { decision: plan.decision, targetMessageId: plan.targetMessageId ?? sourceMessage.id },
        createdAt: Date.now(),
      });
      return { valid: true, reason: "sent", plan };
    } catch (error) {
      await this.store.updateAction(action.id, { status: "FAILED", error: error instanceof Error ? error.message : "unknown error" });
      await this.store.incrementMetric("actionFailures");
      return this.rejectRuntime(sourceMessage, plan, "transport_failure");
    }
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
    await this.store.updateAction(actionId, { status: "SKIPPED", error: reason });
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
