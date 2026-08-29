import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BackupService } from "../src/backup.js";
import { FileStore } from "../src/store.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("backup service", () => {
  it("writes protected state snapshots and applies retention", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-backup-"));
    tempDirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const service = new BackupService(store, dir, 24, 2);
    const first = await service.create();
    await new Promise((resolve) => setTimeout(resolve, 2));
    await service.create();
    await new Promise((resolve) => setTimeout(resolve, 2));
    await service.create();
    const backups = await service.list();
    expect(backups).toHaveLength(2);
    expect(backups.some((backup) => backup.name === first.name)).toBe(false);
    const body = JSON.parse(await readFile(join(dir, "backups", backups[0].name), "utf8")) as { version?: number; state?: unknown };
    expect(body.version).toBe(1);
    expect(body.state).toBeDefined();
    expect((await stat(join(dir, "backups", backups[0].name))).mode & 0o077).toBe(0);
  });
});
