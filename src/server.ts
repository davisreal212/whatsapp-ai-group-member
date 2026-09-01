import express, { type NextFunction, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { AuthService, sessionCookieName } from "./auth.js";
import type { AppConfig } from "./types.js";
import type { BotRuntime } from "./bot.js";
import { personalityPatchSchema } from "./persona.js";

export function createApp(runtime: BotRuntime, config: AppConfig) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use(express.static(join(process.cwd(), "public")));
  const authRateLimit = rateLimit(60_000, 10);

  app.get("/api/health", (_request, response) => {
    response.json({ service: "whatsapp-ai-group-member", ...runtime.health() });
  });
  app.get("/api/ready", (_request, response) => {
    const health = runtime.health();
    response.status(health.ready ? 200 : 503).json(health);
  });

  app.use("/api", rateLimit());
  const auth = new AuthService(runtime.store);
  app.post("/api/auth/signup", authRateLimit, async (request, response) => {
    try {
      const body = authCredentialsSchema.parse(request.body);
      const result = await auth.signUp(body.email, body.password);
      setSessionCookie(response, result.token, config.nodeEnv === "production");
      response.status(201).json({ user: result.user });
    } catch (error) {
      response.status(error instanceof z.ZodError ? 400 : 409).json({ error: error instanceof Error ? error.message : "Unable to create account" });
    }
  });
  app.post("/api/auth/signin", authRateLimit, async (request, response) => {
    try {
      const body = authCredentialsSchema.parse(request.body);
      const result = await auth.signIn(body.email, body.password);
      setSessionCookie(response, result.token, config.nodeEnv === "production");
      response.json({ user: result.user });
    } catch (error) {
      response.status(error instanceof z.ZodError ? 400 : 401).json({ error: error instanceof Error ? error.message : "Unable to sign in" });
    }
  });
  app.get("/api/auth/me", (request, response) => {
    const user = auth.authenticate(readSessionCookie(request));
    if (!user) return response.status(401).json({ error: "Not signed in" });
    response.json({ user });
  });
  app.post("/api/auth/signout", async (request, response) => {
    await auth.signOut(readSessionCookie(request));
    response.setHeader("set-cookie", `${sessionCookieName}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax${config.nodeEnv === "production" ? "; Secure" : ""}`);
    response.status(204).end();
  });

  app.use("/api", requireAdmin(config, auth));
  app.get("/api/status", (_request, response) => response.json(runtime.dashboardState()));
  app.get("/api/personality", (_request, response) => response.json(runtime.personalityForGroup()));
  app.get("/api/groups", (_request, response) => response.json(runtime.store.groups()));
  app.post("/api/groups/sync", async (_request, response, next) => {
    try {
      const groups = await runtime.listGroups();
      await runtime.syncGroups(groups);
      response.json({ groups: runtime.store.groups() });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/dms/sync", (_request, response) => response.json({ contacts: runtime.listDirectMessages() }));
  app.post("/api/groups/:id/enabled", async (request, response, next) => {
    try {
      const body = z.object({ enabled: z.boolean() }).parse(request.body);
      const group = await runtime.setGroupEnabled(request.params.id, body.enabled);
      if (!group) return response.status(404).json({ error: "Group not found" });
      response.json(group);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/groups/:id/paused", async (request, response, next) => {
    try {
      const body = z.object({ aiPaused: z.boolean() }).parse(request.body);
      const group = await runtime.setGroupPaused(request.params.id, body.aiPaused);
      if (!group) return response.status(404).json({ error: "Group not found" });
      response.json(group);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/groups/:id/learning", async (request, response, next) => {
    try {
      const body = z.object({ enabled: z.boolean() }).parse(request.body);
      const group = await runtime.setGroupLearning(request.params.id, body.enabled);
      if (!group) return response.status(404).json({ error: "Group not found" });
      response.json(group);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/groups/:id/personality", async (request, response, next) => {
    try {
      const body = personalityPatchSchema.partial().parse(request.body);
      const group = await runtime.setGroupPersonality(request.params.id, body);
      if (!group) return response.status(404).json({ error: "Group not found" });
      response.json(group);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/personality", async (request, response, next) => {
    try {
      await runtime.setPersonality(personalityPatchSchema.partial().parse(request.body));
      response.json(runtime.config.personality);
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/groups/:id/personality", (request, response) => {
    const group = runtime.store.group(request.params.id);
    if (!group) return response.status(404).json({ error: "Group not found" });
    response.json({ groupId: group.id, personality: runtime.personalityForGroup(group.id), override: group.personalityOverride ?? {} });
  });
  app.post("/api/personality/preview", (request, response, next) => {
    try {
      const body = z.object({ message: z.string().trim().min(1).max(2_000), groupId: z.string().trim().min(1).max(200).optional() }).parse(request.body);
      response.json({ response: runtime.previewPersona(body.message, body.groupId) });
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/skills", (_request, response) => response.json(runtime.skills.list()));
  app.post("/api/skills/:id/enabled", async (request, response, next) => {
    try {
      const body = z.object({ enabled: z.boolean() }).parse(request.body);
      await runtime.setSkillEnabled(request.params.id, body.enabled);
      response.json(runtime.skills.list().find((skill) => skill.skillId === request.params.id));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/members", (request, response) => response.json(runtime.store.members(typeof request.query.groupId === "string" ? request.query.groupId : undefined)));
  app.get("/api/memory/export", (request, response) => response.json(runtime.memoryExport(typeof request.query.scopeId === "string" ? request.query.scopeId : undefined)));
  app.delete("/api/memory/all", async (_request, response, next) => {
    try {
      response.json({ deleted: await runtime.deleteAllMemories() });
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/memory/item/:id", async (request, response, next) => {
    try {
      const deleted = await runtime.deleteMemory(request.params.id);
      if (!deleted) return response.status(404).json({ error: "Memory not found" });
      response.json({ deleted: 1 });
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/memory/scope/:scopeId", async (request, response, next) => {
    try {
      response.json({ deleted: await runtime.resetMemory(request.params.scopeId) });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/memory/rebuild", async (request, response, next) => {
    try {
      const body = z.object({ scopeId: z.string().trim().min(1).max(200).optional() }).parse(request.body);
      response.json(await runtime.rebuildMemoryVectors(body.scopeId));
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/memory/:scopeId", async (request, response, next) => {
    try {
      response.json({ deleted: await runtime.resetMemory(request.params.scopeId) });
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/logs", (request, response) => {
    const parsed = z.coerce.number().int().min(1).max(500).default(100).safeParse(request.query.limit);
    response.json(runtime.store.logs(parsed.success ? parsed.data : 100));
  });
  app.get("/api/actions", (_request, response) => response.json(runtime.store.actions(200)));
  app.get("/api/backups", async (_request, response, next) => {
    try {
      response.json(await runtime.listBackups());
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/backups", async (_request, response, next) => {
    try {
      response.status(201).json(await runtime.createBackup());
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/tasks", (request, response) => {
    const status = typeof request.query.status === "string" ? request.query.status : undefined;
    response.json(runtime.store.tasks(status === "ACTIVE" || status === "TRIGGERED" || status === "PAUSED" || status === "CANCELLED" ? status : undefined));
  });
  app.post("/api/tasks/:id/cancel", async (request, response, next) => {
    try {
      const task = await runtime.cancelTask(request.params.id);
      if (!task) return response.status(404).json({ error: "Task not found" });
      response.json(task);
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/tasks/:id", async (request, response, next) => {
    try {
      const task = await runtime.cancelTask(request.params.id);
      if (!task) return response.status(404).json({ error: "Task not found" });
      response.json(task);
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/tasks/:id", async (request, response, next) => {
    try {
      const body = z.object({
        message: z.string().trim().min(1).max(2000).optional(),
        triggerAt: z.number().int().positive().optional(),
        recurrence: z.enum(["ONCE", "DAILY", "WEEKLY"]).optional(),
        status: z.enum(["ACTIVE", "PAUSED"]).optional(),
      }).refine((value) => Object.keys(value).length > 0).parse(request.body);
      const task = await runtime.updateTask(request.params.id, body);
      if (!task) return response.status(404).json({ error: "Task not found" });
      response.json(task);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/controls", async (request, response, next) => {
    try {
      const body = z.object({ outboundPaused: z.boolean().optional(), aiProcessingPaused: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0).parse(request.body);
      await runtime.setControls(body);
      response.json(runtime.dashboardState().safety);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/participation", async (request, response, next) => {
    try {
      response.json(await runtime.setParticipation(participationSchema.parse(request.body)));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/groups/:id/participation", async (request, response, next) => {
    try {
      const group = await runtime.setGroupParticipation(request.params.id, participationPatchSchema.parse(request.body));
      if (!group) return response.status(404).json({ error: "Group not found" });
      response.json(group);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/dm-allowlist", async (request, response, next) => {
    try {
      const body = z.object({ contacts: z.array(z.string().trim().min(1).max(100)).max(200) }).parse(request.body);
      response.json({ contacts: await runtime.setDirectMessageAllowlist(body.contacts) });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/whatsapp/connect", async (request, response, next) => {
    try {
      const body = z.object({ phoneNumber: z.string().trim().regex(/^\+?[\d\s().-]{7,25}$/).optional() }).parse(request.body);
      await runtime.connect(body.phoneNumber);
      response.json(runtime.dashboardState().connection);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/whatsapp/disconnect", async (_request, response, next) => {
    try {
      await runtime.disconnect();
      response.json(runtime.dashboardState().connection);
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const status = error instanceof z.ZodError ? 400 : 500;
    if (status === 500) console.error(`[http] request failed: ${error instanceof Error ? error.message : "unknown error"}`);
    response.status(status).json({ error: status === 400 ? "Invalid request" : "Unexpected error" });
  });
  return app;
}

const participationFieldsSchema = z.object({
  groupCooldownMs: z.coerce.number().int().min(0).max(86_400_000),
  directReplyBypass: z.boolean(),
  directMentionBypass: z.boolean(),
  directReplyDelayMinMs: z.coerce.number().int().min(0).max(60_000),
  directReplyDelayMaxMs: z.coerce.number().int().min(0).max(60_000),
  directMentionDelayMinMs: z.coerce.number().int().min(0).max(60_000),
  directMentionDelayMaxMs: z.coerce.number().int().min(0).max(60_000),
  adaptiveActivity: z.boolean(),
  groupMentionAllCooldownMs: z.coerce.number().int().min(0).max(86_400_000),
});
const participationSchema = participationFieldsSchema.refine((value) => value.directReplyDelayMaxMs >= value.directReplyDelayMinMs && value.directMentionDelayMaxMs >= value.directMentionDelayMinMs, "Delay maximum must be at least its minimum");
const participationPatchSchema = participationFieldsSchema.partial();

function requireAdmin(config: AppConfig, auth: AuthService) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!config.adminToken && config.nodeEnv !== "production") return next();
    const header = request.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : request.header("x-admin-token");
    if (token && config.adminToken && secretsEqual(token, config.adminToken)) return next();
    const user = auth.authenticate(readSessionCookie(request));
    if (!user || user.role !== "admin") return response.status(401).json({ error: "Authentication required" });
    next();
  };
}

function secretsEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

const authCredentialsSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(128),
});

function readSessionCookie(request: Request): string | undefined {
  const cookies = request.header("cookie")?.split(";").map((cookie) => cookie.trim()) ?? [];
  const session = cookies.find((cookie) => cookie.startsWith(`${sessionCookieName}=`));
  return session?.slice(sessionCookieName.length + 1);
}

function setSessionCookie(response: Response, token: string, secure: boolean): void {
  response.setHeader("set-cookie", `${sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure ? "; Secure" : ""}`);
}

function rateLimit(windowMs = 60_000, maxRequests = 120) {
  const clients = new Map<string, { count: number; resetAt: number }>();
  return (request: Request, response: Response, next: NextFunction) => {
    const now = Date.now();
    const key = request.ip || "unknown";
    const current = clients.get(key);
    if (!current || current.resetAt <= now) {
      clients.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > maxRequests) return response.status(429).json({ error: "Rate limit exceeded" });
    next();
  };
}
