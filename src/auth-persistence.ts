import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { neon } from "@neondatabase/serverless";

// Mirrors the Baileys multi-file auth directory into durable storage so a
// Render restart (ephemeral disk) does not log the WhatsApp session out.
export interface AuthPersistence {
  // Writes the directory's files into durable storage (replacing the previous snapshot).
  save(dir: string): Promise<void>;
  // Recreates the directory from durable storage. No-op when nothing was saved.
  restore(dir: string): Promise<boolean>;
  // Removes the durable snapshot.
  clear(): Promise<void>;
}

export type AuthSnapshot = Map<string, Buffer>;

export async function readAuthDir(dir: string): Promise<AuthSnapshot> {
  const files: AuthSnapshot = new Map();
  let entries: string[];
  try {
    entries = await readdir(dir, { recursive: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const content = await readFile(full).catch(() => undefined);
    if (!content) continue;
    // Only regular files: readFile on a directory fails and is skipped above.
    files.set(relative(dir, full).split(sep).join("/"), content);
  }
  return files;
}

export async function writeAuthDir(dir: string, files: AuthSnapshot): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const [name, content] of files) {
    const target = join(dir, ...name.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, { mode: 0o600 });
  }
}

export function createNeonAuthPersistence(databaseUrl: string): AuthPersistence {
  const sql = neon(databaseUrl);
  let schemaReady: Promise<void> | undefined;
  const ensureSchema = () => {
    schemaReady ??= sql`CREATE TABLE IF NOT EXISTS whatsapp_auth_files (name text PRIMARY KEY, content bytea NOT NULL, updated_at bigint NOT NULL)`.then(() => undefined);
    return schemaReady;
  };

  return {
    async save(dir) {
      await ensureSchema();
      const files = await readAuthDir(dir);
      const now = Date.now();
      const names = [...files.keys()];
      // Serialize the whole snapshot in one transaction so a restart never sees a half-written set.
      const queries = names.map((name) => sql`INSERT INTO whatsapp_auth_files (name, content, updated_at) VALUES (${name}, ${files.get(name)!}, ${now})
        ON CONFLICT (name) DO UPDATE SET content = EXCLUDED.content, updated_at = EXCLUDED.updated_at`);
      queries.push(sql`DELETE FROM whatsapp_auth_files WHERE NOT (name = ANY(${names}))`);
      await sql.transaction(queries);
    },
    async restore(dir) {
      await ensureSchema();
      const rows = (await sql`SELECT name, content FROM whatsapp_auth_files`) as Array<{ name: string; content: Uint8Array }>;
      if (rows.length === 0) return false;
      await rm(dir, { recursive: true, force: true });
      await writeAuthDir(dir, new Map(rows.map((row) => [row.name, Buffer.from(row.content)])));
      return true;
    },
    async clear() {
      await ensureSchema();
      await sql`DELETE FROM whatsapp_auth_files`;
    },
  };
}
