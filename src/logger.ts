import fs from "node:fs";
import path from "node:path";
import { format } from "node:util";

const LOG_DIR = path.resolve(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "app.log");
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB: oltre questa soglia si ruota, per non crescere all'infinito

function rotateIfNeeded(): void {
  try {
    if (fs.statSync(LOG_FILE).size > MAX_SIZE_BYTES) {
      fs.renameSync(LOG_FILE, path.join(LOG_DIR, `app.${Date.now()}.log`));
    }
  } catch {
    // primo avvio: il file di log non esiste ancora, niente da ruotare
  }
}

function writeLine(level: string, args: unknown[]): void {
  rotateIfNeeded();
  const line = `[${new Date().toISOString()}] [${level}] ${format(...args)}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // un problema di scrittura sul log non deve mai far cadere l'app
  }
}

/**
 * Fa si' che console.log/warn/error scrivano anche su file, oltre che sulla
 * console (se presente). Necessario perche' in Fase 6 il processo gira in
 * background via Task Scheduler, senza un terminale visibile da cui leggere
 * i log: senza questo, gli errori sarebbero invisibili.
 *
 * Va chiamata il prima possibile in index.ts (prima che whatsapp/connection.ts
 * installi il proprio filtro per il rumore di libsignal): cosi' questo wrapper
 * resta il piu' interno e le righe di rumore, filtrate dal layer successivo,
 * non finiscono comunque nel file.
 */
export function initFileLogging(): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });

  (["log", "warn", "error"] as const).forEach((method) => {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      writeLine(method.toUpperCase(), args);
      original(...args);
    };
  });
}
