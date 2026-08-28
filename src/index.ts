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
  });
  runtime = new BotRuntime(store, config, whatsapp);
  await runtime.init();

  const server = createServer(createApp(runtime, config));
  server.listen(config.port, () => {
    console.log(`WhatsApp AI group member listening on http://localhost:${config.port}`);
    console.log(`Safety: group-only=${config.groupOnlyMode} dry-run=${config.dryRun} outbound-paused=${config.outboundPaused}`);
  });

  const shutdown = async () => {
    await whatsapp.disconnect();
    server.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
