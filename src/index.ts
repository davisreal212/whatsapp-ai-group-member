import { createServer } from "node:http";
import { BotRuntime } from "./bot.js";
import { loadConfig } from "./config.js";
import { createApp } from "./server.js";
import { FileStore } from "./store.js";
import { PostgresStore } from "./postgres-store.js";
import { BaileysWhatsAppAdapter } from "./whatsapp.js";
import type { WACallEvent } from "@whiskeysockets/baileys";

async function main(): Promise<void> {
  const config = loadConfig();
  const vectorJobsEnabled = config.embeddingProvider === "gemini" && Boolean(config.qdrantUrl);
  const store = config.databaseUrl ? new PostgresStore(config.databaseUrl, vectorJobsEnabled) : new FileStore(config.dataDir, vectorJobsEnabled);
  let runtime: BotRuntime;
  const whatsapp = new BaileysWhatsAppAdapter(config.whatsappAuthDir, store, {
    onRawMessage: async (message, loadMedia, resolvePhone) => runtime.handleRawMessage(message, loadMedia, resolvePhone),
    onGroups: async (groups) => runtime.syncGroups(groups),
    onIncomingCalls: async (calls: WACallEvent[]) => runtime.handleIncomingCalls(calls),
    onIdentity: async (identities) => runtime.setBotIdentities(identities),
  }, config.maxMediaBytes, config.maxVideoDurationSeconds);
  runtime = new BotRuntime(store, config, whatsapp);
  await runtime.init();
  runtime.startBackgroundWorkers();

  const server = createServer(createApp(runtime, config));
  server.listen(config.port, () => {
    console.log(`WhatsApp AI group member listening on http://localhost:${config.port}`);
    console.log(`Safety: group-only=${config.groupOnlyMode} dry-run=${config.dryRun} outbound-paused=${config.outboundPaused}`);
    void whatsapp.connect().catch(async (error) => {
      console.error(`[whatsapp] startup connection failure: ${error instanceof Error ? error.message : "unknown"}`);
      await store.addLog({
        id: crypto.randomUUID(),
        event: "whatsapp.startup_connection_failure",
        level: "error",
        details: { error: error instanceof Error ? error.message : "unknown error" },
        createdAt: Date.now(),
      });
    });
  });

  const shutdown = async () => {
    await runtime.stopBackgroundWorkers();
    await whatsapp.stop();
    server.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
