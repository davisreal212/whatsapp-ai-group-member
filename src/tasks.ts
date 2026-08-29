import { randomUUID } from "node:crypto";
import type { AppConfig, CanonicalMessage, TaskRecord } from "./types.js";
import type { Store } from "./store.js";
import type { OutboundTransport } from "./actions.js";

const CHECK_INTERVAL_MS = 30_000;
const PRICE_CHECK_INTERVAL_MS = 60_000;
const MAX_ACTIVE_TASKS_PER_OWNER = 20;
const SUPPORTED_ASSETS = ["bitcoin", "ethereum"] as const;

export interface PriceProvider {
  readonly name: string;
  getPrices(assets: string[]): Promise<Record<string, number>>;
}

export interface TaskCommandResult {
  handled: boolean;
  reply?: string;
}

export class TaskService {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private lastRunAt?: number;
  private lastError?: string;

  constructor(
    private readonly store: Store,
    private readonly config: AppConfig,
    private readonly transport: OutboundTransport,
    private readonly priceProvider: PriceProvider = new FallbackPriceProvider(),
  ) {}

  start(): void {
    if (this.timer) return;
    this.runSafely();
    this.timer = setInterval(() => this.runSafely(), CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  health(): { running: boolean; lastRunAt?: number; lastError?: string } {
    return { running: Boolean(this.timer), ...(this.lastRunAt ? { lastRunAt: this.lastRunAt } : {}), ...(this.lastError ? { lastError: this.lastError } : {}) };
  }

  private runSafely(): void {
    void this.runDueTasks().catch(async (error) => {
      this.lastError = error instanceof Error ? error.message : "unknown";
      await this.log("task.worker_failed", { error: error instanceof Error ? error.message : "unknown" });
    });
  }

  async handleMessage(message: CanonicalMessage): Promise<TaskCommandResult> {
    const text = (message.text ?? "").trim();
    if (!text) return { handled: false };
    const conversationId = message.groupId ?? message.chatId;

    if (/\b(?:cancel|stop|delete)\b.*\b(?:alert|reminder|task)\b/i.test(text)) {
      const task = this.store.tasks("ACTIVE").find((item) => item.groupId === conversationId && item.creatorId === message.senderId);
      if (!task) return { handled: true, reply: "You don't have an active alert or reminder here." };
      await this.store.updateTask(task.id, { status: "CANCELLED", lastError: undefined });
      await this.log("task.cancelled", { taskId: task.id, type: task.type }, message);
      return { handled: true, reply: `Done, I cancelled your ${task.type === "PRICE_ALERT" ? "price alert" : "reminder"}.` };
    }

    if (/\b(?:what|which|list|show)\b.*\b(?:alerts?|reminders?|tasks?)\b/i.test(text)) {
      const tasks = this.store.tasks("ACTIVE").filter((item) => item.groupId === conversationId && item.creatorId === message.senderId);
      return { handled: true, reply: formatTaskList(tasks) };
    }

    const price = parsePriceAlert(text);
    if (price) return { handled: true, reply: await this.createTask(message, conversationId, price) };

    if (/\bremind me\b/i.test(text)) {
      const reminder = parseReminder(text);
      if (reminder.error) return { handled: true, reply: reminder.error };
      if (!reminder.triggerAt || !reminder.message) return { handled: true, reply: "What day and time should I remind you, and what should I remind you about?" };
      return { handled: true, reply: await this.createTask(message, conversationId, {
        type: "REMINDER",
        message: reminder.message,
        triggerAt: reminder.triggerAt,
        recurrence: "ONCE",
      }) };
    }

    return { handled: false };
  }

  async cancelTask(id: string): Promise<TaskRecord | undefined> {
    const task = this.store.task(id);
    if (!task || task.status === "CANCELLED" || task.status === "TRIGGERED") return task;
    const updated = await this.store.updateTask(id, { status: "CANCELLED", lastError: undefined });
    if (updated) await this.log("task.cancelled", { taskId: id, source: "dashboard" });
    return updated;
  }

  private async createTask(message: CanonicalMessage, conversationId: string, draft: TaskDraft): Promise<string> {
    const activeOwned = this.store.tasks("ACTIVE").filter((task) => task.groupId === conversationId && task.creatorId === message.senderId);
    if (activeOwned.length >= MAX_ACTIVE_TASKS_PER_OWNER) return "You have reached the active task limit for this chat.";
    const task: TaskRecord = {
      id: randomUUID(),
      groupId: conversationId,
      creatorId: message.senderId,
      creatorChatId: message.chatId,
      type: draft.type,
      ...(draft.condition ? { condition: draft.condition } : {}),
      message: draft.message,
      status: "ACTIVE",
      ...(draft.triggerAt ? { triggerAt: draft.triggerAt } : {}),
      recurrence: draft.recurrence,
      notificationTarget: message.isGroup ? "GROUP" : "USER",
      notificationChatId: message.isGroup ? message.chatId : message.chatId,
      createdAt: Date.now(),
      retryCount: 0,
    };
    if (!(await this.store.createTask(task))) return "I couldn't save that task. Please try again.";
    await this.log("task.created", { taskId: task.id, type: task.type, ...(task.condition ? { condition: task.condition } : {}), ...(task.triggerAt ? { triggerAt: task.triggerAt } : {}) }, message);
    return task.type === "PRICE_ALERT"
      ? `Sharp, I'll let you know when ${task.condition?.asset?.toUpperCase()} ${task.condition?.operator === "lte" ? "drops to" : "reaches"} $${formatNumber(task.condition?.threshold ?? 0)}.`
      : `Sharp, I'll remind you ${formatReminderTime(task.triggerAt ?? Date.now())}.`;
  }

  private async runDueTasks(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.lastRunAt = Date.now();
    this.lastError = undefined;
    try {
    const now = Date.now();
    const active = this.store.tasks("ACTIVE");
    for (const task of active.filter((item) => item.type === "REMINDER" && item.triggerAt !== undefined && item.triggerAt <= now)) {
      await this.triggerReminder(task);
    }
    const priceTasks = active.filter((task) => task.type === "PRICE_ALERT" && (!task.lastCheckedAt || now - task.lastCheckedAt >= PRICE_CHECK_INTERVAL_MS));
    if (priceTasks.length) await this.checkPriceAlerts(priceTasks, now);
    } finally {
      this.running = false;
    }
  }

  private async triggerReminder(task: TaskRecord): Promise<void> {
    if (!(await this.notify(task, `Reminder: ${task.message}`))) return;
    if (task.recurrence === "DAILY" || task.recurrence === "WEEKLY") {
      const interval = task.recurrence === "DAILY" ? 86_400_000 : 7 * 86_400_000;
      await this.store.updateTask(task.id, { triggerAt: (task.triggerAt ?? Date.now()) + interval });
    } else {
      await this.store.updateTask(task.id, { status: "TRIGGERED", lastError: undefined });
    }
  }

  private async checkPriceAlerts(tasks: TaskRecord[], now: number): Promise<void> {
    let prices: Record<string, number>;
    try {
      const assets = [...new Set(tasks.map((task) => task.condition?.asset).filter((asset): asset is string => Boolean(asset)))];
      prices = await this.priceProvider.getPrices(assets);
    } catch (error) {
      for (const task of tasks) await this.store.updateTask(task.id, { lastCheckedAt: now, lastError: error instanceof Error ? error.message : "price provider failed", retryCount: task.retryCount + 1 });
      await this.log("task.price_check_failed", { count: tasks.length, provider: this.priceProvider.name, error: error instanceof Error ? error.message : "unknown" });
      return;
    }
    for (const task of tasks) {
      const condition = task.condition;
      const price = condition?.asset ? prices[condition.asset] : undefined;
      await this.store.updateTask(task.id, { lastCheckedAt: now, lastSuccessfulCheck: now, lastError: undefined, retryCount: 0 });
      if (price === undefined || condition?.threshold === undefined) continue;
      const triggered = condition.operator === "lte" ? price <= condition.threshold : price >= condition.threshold;
      if (!triggered) continue;
      if (!(await this.notify(task, `Abeg 😂 ${condition.asset === "bitcoin" ? "BTC" : "ETH"} don cross $${formatNumber(price)}.`))) continue;
      await this.store.updateTask(task.id, { status: "TRIGGERED", lastError: undefined });
    }
  }

  private async notify(task: TaskRecord, text: string): Promise<boolean> {
    if (this.config.dryRun || this.config.outboundPaused || !this.transport.connected) {
      await this.store.updateTask(task.id, { lastError: this.config.dryRun ? "dry_run" : this.config.outboundPaused ? "outbound_paused" : "transport_disconnected" });
      return false;
    }
    try {
      await this.transport.sendText(task.notificationChatId, text);
      await this.log("task.notification_sent", { taskId: task.id, type: task.type });
      return true;
    } catch (error) {
      await this.store.updateTask(task.id, { lastError: error instanceof Error ? error.message : "notification failed", retryCount: task.retryCount + 1 });
      await this.log("task.notification_failed", { taskId: task.id, error: error instanceof Error ? error.message : "unknown" });
      return false;
    }
  }

  private async log(event: string, details: Record<string, unknown>, message?: CanonicalMessage): Promise<void> {
    await this.store.addLog({ id: randomUUID(), event, level: event.endsWith("failed") ? "warn" : "info", ...(message?.id ? { messageId: message.id } : {}), ...(message?.groupId ? { groupId: message.groupId } : {}), details, createdAt: Date.now() });
  }
}

class FallbackPriceProvider implements PriceProvider {
  readonly name = "coingecko+coinbase";
  private readonly providers: PriceProvider[] = [new CoinGeckoPriceProvider(), new CoinbasePriceProvider()];

  async getPrices(assets: string[]): Promise<Record<string, number>> {
    let lastError: unknown;
    for (const provider of this.providers) {
      try {
        return await provider.getPrices(assets);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("all price providers failed");
  }
}

class CoinGeckoPriceProvider implements PriceProvider {
  readonly name = "coingecko";

  async getPrices(assets: string[]): Promise<Record<string, number>> {
    const supported = assets.filter((asset): asset is typeof SUPPORTED_ASSETS[number] => SUPPORTED_ASSETS.includes(asset as typeof SUPPORTED_ASSETS[number]));
    if (!supported.length) return {};
    const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${supported.join(",")}&vs_currencies=usd`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`CoinGecko returned HTTP ${response.status}`);
    const body = await response.json() as Record<string, { usd?: unknown }>;
    const prices: Record<string, number> = {};
    for (const asset of supported) {
      const price = body[asset]?.usd;
      if (typeof price !== "number" || !Number.isFinite(price)) throw new Error(`CoinGecko returned no USD price for ${asset}`);
      prices[asset] = price;
    }
    return prices;
  }
}

class CoinbasePriceProvider implements PriceProvider {
  readonly name = "coinbase";

  async getPrices(assets: string[]): Promise<Record<string, number>> {
    const supported = assets.filter((asset): asset is typeof SUPPORTED_ASSETS[number] => SUPPORTED_ASSETS.includes(asset as typeof SUPPORTED_ASSETS[number]));
    const entries = await Promise.all(supported.map(async (asset) => {
      const symbol = asset === "bitcoin" ? "BTC" : "ETH";
      const response = await fetch(`https://api.coinbase.com/v2/exchange-rates?currency=${symbol}`, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Coinbase returned HTTP ${response.status}`);
      const body = await response.json() as { data?: { rates?: Record<string, string> } };
      const price = Number(body.data?.rates?.USD);
      if (!Number.isFinite(price)) throw new Error(`Coinbase returned no USD price for ${asset}`);
      return [asset, price] as const;
    }));
    return Object.fromEntries(entries);
  }
}

interface TaskDraft {
  type: TaskRecord["type"];
  message: string;
  recurrence: TaskRecord["recurrence"];
  triggerAt?: number;
  condition?: TaskRecord["condition"];
}

function parsePriceAlert(text: string): TaskDraft | undefined {
  if (!/\b(?:alert|notify|tell me|let me know|when|once|if)\b/i.test(text)) return undefined;
  const match = text.match(/\b(bitcoin|btc|ethereum|eth)\b[\s\S]{0,80}?\$?([\d]+(?:[,.][\d]+)?)\s*(k|thousand)?\b/i);
  if (!match) return undefined;
  const asset = /bitcoin|btc/i.test(match[1] ?? "") ? "bitcoin" : "ethereum";
  const threshold = Number((match[2] ?? "").replace(/,/g, "")) * (/^(?:k|thousand)$/i.test(match[3] ?? "") ? 1000 : 1);
  if (!Number.isFinite(threshold) || threshold <= 0) return undefined;
  const operator = /\b(?:below|under|less than|drops? to|falls? to)\b/i.test(text) ? "lte" : "gte";
  return { type: "PRICE_ALERT", message: `${asset} ${operator} ${threshold}`, condition: { asset, operator, threshold, currency: "USD" }, recurrence: "ONCE" };
}

function parseReminder(text: string): { triggerAt?: number; message?: string; error?: string } {
  const body = text.replace(/^.*?\bremind me\b/i, "").trim();
  const match = body.match(/^(?:(today|tomorrow)\b\s*)?(?:at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b\s*)?(?:to\s+)?(.+)$/i);
  if (!match) return { error: "Tell me the day, time, and reminder, for example: remind me tomorrow at 8pm to call David." };
  const day = match[1]?.toLowerCase();
  const hour = match[2] ? Number(match[2]) : undefined;
  const minute = match[3] ? Number(match[3]) : 0;
  const meridiem = match[4]?.toLowerCase();
  const message = match[5]?.trim();
  if (hour === undefined || !message || minute > 59 || hour > 23 || (meridiem && hour > 12)) return { error: "What day and time should I use? For example: remind me tomorrow at 8pm to call David." };
  let normalizedHour = hour;
  if (meridiem === "pm" && normalizedHour < 12) normalizedHour += 12;
  if (meridiem === "am" && normalizedHour === 12) normalizedHour = 0;
  const trigger = new Date();
  if (day === "tomorrow") trigger.setDate(trigger.getDate() + 1);
  trigger.setHours(normalizedHour, minute, 0, 0);
  if (!day && trigger.getTime() <= Date.now()) trigger.setDate(trigger.getDate() + 1);
  return { triggerAt: trigger.getTime(), message };
}

function formatTaskList(tasks: TaskRecord[]): string {
  if (!tasks.length) return "You don't have any active alerts or reminders here.";
  return `Your active tasks:\n${tasks.slice(0, 10).map((task) => task.type === "PRICE_ALERT" ? `- ${task.condition?.asset?.toUpperCase()} ${task.condition?.operator === "lte" ? "≤" : "≥"} $${formatNumber(task.condition?.threshold ?? 0)}` : `- ${task.message} (${formatReminderTime(task.triggerAt ?? Date.now())})`).join("\n")}`;
}

function formatReminderTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}
