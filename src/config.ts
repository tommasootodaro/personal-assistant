import process from "node:process";
import path from "node:path";

try {
  process.loadEnvFile(path.resolve(process.cwd(), ".env"));
} catch {
  // .env assente: si prosegue con le sole variabili d'ambiente di sistema
}

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  obsidianVaultPath: process.env.OBSIDIAN_VAULT_PATH ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  /** Orario "HH:MM" (fuso Europe/Rome) di invio del digest mattutino proattivo. */
  morningDigestTime: process.env.MORNING_DIGEST_TIME ?? "07:30",
  /** Orario "HH:MM" (fuso Europe/Rome) del promemoria mattutino sugli impegni. */
  eventReminderTime: process.env.EVENT_REMINDER_TIME ?? "07:30",
};
