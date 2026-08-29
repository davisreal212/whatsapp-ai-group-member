import { chmod, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Store } from "./store.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BackupInfo {
  name: string;
  createdAt: number;
  sizeBytes: number;
}

export class BackupService {
  private timer?: ReturnType<typeof setInterval>;
  private lastRunAt?: number;
  private lastError?: string;

  constructor(
    private readonly store: Store,
    private readonly dataDir: string,
    private readonly intervalHours = 24,
    private readonly retentionCount = 7,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.create().catch((error) => this.recordError(error));
    this.timer = setInterval(() => {
      void this.create().catch((error) => this.recordError(error));
    }, Math.max(1, this.intervalHours) * 60 * 60 * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  health(): { running: boolean; lastRunAt?: number; lastError?: string } {
    return {
      running: Boolean(this.timer),
      ...(this.lastRunAt ? { lastRunAt: this.lastRunAt } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  async create(): Promise<BackupInfo> {
    const backupDir = join(this.dataDir, "backups");
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    await chmod(backupDir, 0o700);
    const createdAt = Date.now();
    const name = `state-${new Date(createdAt).toISOString().replace(/[:.]/g, "-")}.json`;
    const target = join(backupDir, name);
    const temporary = `${target}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, createdAt, state: this.store.snapshot }, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
    const details = await stat(target);
    await this.prune(backupDir);
    this.lastRunAt = createdAt;
    this.lastError = undefined;
    return { name, createdAt, sizeBytes: details.size };
  }

  async list(): Promise<BackupInfo[]> {
    const backupDir = join(this.dataDir, "backups");
    let names: string[];
    try {
      names = await readdir(backupDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const backups: BackupInfo[] = [];
    for (const name of names.filter((item) => /^state-[\dTZ-]+\.json$/.test(item))) {
      const details = await stat(join(backupDir, name));
      backups.push({ name, createdAt: details.mtimeMs, sizeBytes: details.size });
    }
    return backups.sort((a, b) => b.name.localeCompare(a.name));
  }

  private async prune(backupDir: string): Promise<void> {
    const backups = await this.list();
    for (const backup of backups.slice(Math.max(1, this.retentionCount))) await rm(join(backupDir, backup.name), { force: true });
  }

  private recordError(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : "backup failed";
  }
}
