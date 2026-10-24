import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAuthDir, writeAuthDir } from "../src/auth-persistence.js";

describe("whatsapp auth snapshot", () => {
  it("round-trips nested auth files through the snapshot format", async () => {
    const root = await mkdtemp(join(tmpdir(), "wa-auth-"));
    try {
      const source = join(root, "source");
      await mkdir(join(source, "sessions"), { recursive: true });
      await writeFile(join(source, "creds.json"), "{\"registered\":true}");
      await writeFile(join(source, "sessions", "a.json"), "session-a");

      const snapshot = await readAuthDir(source);
      expect([...snapshot.keys()].sort()).toEqual(["creds.json", "sessions/a.json"]);

      const target = join(root, "restored");
      await writeAuthDir(target, snapshot);
      expect(await readFile(join(target, "creds.json"), "utf8")).toBe("{\"registered\":true}");
      expect(await readFile(join(target, "sessions", "a.json"), "utf8")).toBe("session-a");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
