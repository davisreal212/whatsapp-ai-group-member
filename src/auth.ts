import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Store } from "./store.js";
import type { SessionRecord, UserRecord, UserRole } from "./types.js";

const scryptAsync = promisify(scrypt);
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PublicUser {
  id: string;
  email: string;
  role: UserRole;
}

export class AuthService {
  constructor(private readonly store: Store) {}

  async signUp(emailInput: string, password: string): Promise<{ token: string; user: PublicUser }> {
    const email = normalizeEmail(emailInput);
    validateCredentials(email, password);
    if (this.store.userCount() > 0) throw new Error("Sign-up is closed; sign in with the existing administrator account.");
    const user: UserRecord = {
      id: randomUUID(),
      email,
      passwordHash: await hashPassword(password),
      role: "admin",
      createdAt: Date.now(),
    };
    if (!(await this.store.createUser(user))) throw new Error("An account with that email already exists.");
    return { token: await this.createSession(user), user: publicUser(user) };
  }

  async signIn(emailInput: string, password: string): Promise<{ token: string; user: PublicUser }> {
    const email = normalizeEmail(emailInput);
    const user = this.store.userByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new Error("Invalid email or password.");
    return { token: await this.createSession(user), user: publicUser(user) };
  }

  authenticate(token: string | undefined): PublicUser | undefined {
    if (!token) return undefined;
    const tokenHash = hashToken(token);
    const session = this.store.sessionByTokenHash(tokenHash);
    if (!session || session.expiresAt <= Date.now()) return undefined;
    const user = this.store.userById(session.userId);
    return user ? publicUser(user) : undefined;
  }

  async signOut(token: string | undefined): Promise<void> {
    if (token) await this.store.deleteSession(hashToken(token));
  }

  private async createSession(user: UserRecord): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    const session: SessionRecord = {
      tokenHash: hashToken(token),
      userId: user.id,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    await this.store.createSession(session);
    return token;
  }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function validateCredentials(email: string, password: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (password.length < 8 || password.length > 128) throw new Error("Password must be 8 to 128 characters.");
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, encoded] = stored.split("$");
  if (!salt || !encoded) return false;
  const expected = Buffer.from(encoded, "hex");
  if (expected.length !== 64) return false;
  const actual = await scryptAsync(password, salt, expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function publicUser(user: UserRecord): PublicUser {
  return { id: user.id, email: user.email, role: user.role };
}

export const sessionCookieName = "wa_session";
