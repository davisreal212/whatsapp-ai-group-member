import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuthService } from "../src/auth.js";
import { FileStore } from "../src/store.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("administrator authentication", () => {
  it("creates the first administrator with a hashed password and session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-auth-test-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const auth = new AuthService(store);
    const result = await auth.signUp("Admin@Example.com", "correct horse battery staple");
    expect(result.user).toMatchObject({ email: "admin@example.com", role: "admin" });
    expect(store.snapshot.users[result.user.id]?.passwordHash).not.toContain("correct horse");
    expect(auth.authenticate(result.token)).toEqual(result.user);
    await expect(auth.signIn("admin@example.com", "wrong password")).rejects.toThrow("Invalid email or password");
  });

  it("closes public signup after the first account", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-auth-test-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const auth = new AuthService(store);
    await auth.signUp("first@example.com", "correct horse battery staple");
    await expect(auth.signUp("second@example.com", "correct horse battery staple")).rejects.toThrow("Sign-up is closed");
  });
});
