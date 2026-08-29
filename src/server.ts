import express, { type NextFunction, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { AuthService, sessionCookieName } from "./auth.js";
import type { AppConfig } from "./types.js";
import type { BotRuntime } from "./bot.js";

export function createApp(runtime: BotRuntime, config: AppConfig) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use(express.static(join(process.cwd(), "public")));
  const authRateLimit = rateLimit(60_000, 10);

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok", service: "whatsapp-ai-group-member" });
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
  app.post("/api/groups/:id/personality", async (request, response, next) => {
    try {
      const body = personalitySchema.partial().parse(request.body);
      const group = await runtime.setGroupPersonality(request.params.id, body);
      if (!group) return response.status(404).json({ error: "Group not found" });
      response.json(group);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/personality", async (request, response, next) => {
    try {
      await runtime.setPersonality(personalitySchema.partial().parse(request.body));
      response.json(runtime.config.personality);
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/members", (request, response) => response.json(runtime.store.members(typeof request.query.groupId === "string" ? request.query.groupId : undefined)));
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
    const message = error instanceof z.ZodError ? "Invalid request" : error instanceof Error ? error.message : "Unexpected error";
    const status = error instanceof z.ZodError ? 400 : 500;
    response.status(status).json({ error: message });
  });
  return app;
}

const personalitySchema = z.object({
  displayName: z.string().min(1).max(40),
  genderPresentation: z.enum(["neutral", "masculine", "feminine"]),
  tone: z.enum(["casual", "playful", "warm", "formal"]),
  talkativeness: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  formality: z.number().min(0).max(1),
  languageMix: z.enum(["english", "pidgin", "mixed"]),
  emojiFrequency: z.number().min(0).max(1),
  initiative: z.number().min(0).max(1),
  responseLength: z.enum(["short", "medium", "long"]),
});

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
