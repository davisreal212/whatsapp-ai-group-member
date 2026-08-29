import { createServer } from "node:http";
import { BotRuntime } from "./bot.js";
import { loadConfig } from "./config.js";
import { createApp } from "./server.js";
import { FileStore } from "./store.js";
import { PostgresStore } from "./postgres-store.js";
import { BaileysWhatsAppAdapter } from "./whatsapp.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = config.databaseUrl ? new PostgresStore(config.databaseUrl) : new FileStore(config.dataDir);
  let runtime: BotRuntime;
  const whatsapp = new BaileysWhatsAppAdapter(config.whatsappAuthDir, store, {
    onRawMessage: async (message) => runtime.handleRawMessage(message),
    onGroups: async (groups) => runtime.syncGroups(groups),
    onIdentity: async (identities) => runtime.setBotIdentities(identities),
  });
  runtime = new BotRuntime(store, config, whatsapp);
  await runtime.init();

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
