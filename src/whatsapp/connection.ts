import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  areJidsSameUser,
  downloadMediaMessage,
} from "baileys";
import type { WASocket, WAMessage } from "baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcodeTerminal from "qrcode-terminal";
import QRCode from "qrcode";
import path from "node:path";
import { transcribeVoiceNote } from "./transcribe.js";

const AUTH_FOLDER = "auth";
const QR_IMAGE_PATH = path.resolve(process.cwd(), "whatsapp-qr.png");

const logger = pino({ level: "silent" });

// "libsignal" (usata da Baileys per la gestione delle sessioni crittografate)
// scrive alcuni log interni direttamente su console.info/warn, ignorando il
// logger pino passato sopra: li filtriamo qui per non sporcare l'output.
const NOISY_LIBSIGNAL_PREFIXES = [
  "Closing session:",
  "Removing old closed session:",
  "Session already closed",
  "Session already open",
];

function silenceLibsignalNoise(method: "info" | "warn"): void {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]) => {
    if (typeof args[0] === "string" && NOISY_LIBSIGNAL_PREFIXES.some((p) => (args[0] as string).startsWith(p))) {
      return;
    }
    original(...args);
  };
}

// Parole/frasi che contano come conferma esplicita di una trascrizione vocale
// (confronto esatto sull'intero messaggio normalizzato, non substring: "si"
// e' una parola troppo comune in italiano per essere cercata dentro frasi
// piu' lunghe senza generare falsi positivi).
const CONFIRMATION_WORDS = new Set([
  "si",
  "sì",
  "ok",
  "okay",
  "va bene",
  "vabbene",
  "conferma",
  "confermo",
  "procedi",
  "vai",
  "esatto",
  "giusto",
  "corretto",
]);

function isConfirmation(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?,]+$/, "");
  return CONFIRMATION_WORDS.has(normalized);
}

export interface WhatsAppContext {
  sock: WASocket;
  /** Manda un messaggio e lo marca come "proprio", cosi' non viene ripassato a onMessage. */
  send: (jid: string, text: string) => Promise<void>;
}

export type MessageHandler = (
  ctx: WhatsAppContext,
  remoteJid: string,
  text: string
) => void | Promise<void>;

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export async function connectWhatsApp(
  onOpen?: (ctx: WhatsAppContext) => void,
  onMessage?: MessageHandler
): Promise<void> {
  // Chiamata qui (non a top-level del modulo) cosi' initFileLogging(), se
  // gia' installata da index.ts, resta il layer piu' interno: le righe di
  // rumore filtrate da questo wrapper non finiscono nel file di log.
  silenceLibsignalNoise("info");
  silenceLibsignalNoise("warn");

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const ownMessageIds = new Set<string>();
  // Trascrizione vocale in attesa di conferma dell'utente, per jid. Vive qui
  // (non dentro start()) cosi' sopravvive a un'eventuale riconnessione nel
  // mezzo di una conferma.
  const pendingTranscriptions = new Map<string, string>();
  // Cresce esponenzialmente ad ogni riconnessione fallita consecutiva (fino al
  // cap), per non martellare i server WhatsApp durante un'interruzione di rete
  // prolungata; si resetta non appena la connessione torna "open".
  let reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;

  // Ogni riconnessione crea un nuovo WASocket con i propri listener: se non
  // smontiamo esplicitamente quelli del socket precedente, restano agganciati
  // e un singolo messaggio in arrivo puo' essere gestito piu' volte (piu'
  // chiamate a Claude per lo stesso messaggio, oltre al comportamento errato).
  function start(): void {
    const sock = makeWASocket({
      auth: state,
      logger,
    });

    const send = async (jid: string, text: string) => {
      const sent = await sock.sendMessage(jid, { text });
      if (sent?.key?.id) ownMessageIds.add(sent.key.id);
    };
    const ctx: WhatsAppContext = { sock, send };

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrcodeTerminal.generate(qr, { small: true });
        QRCode.toFile(QR_IMAGE_PATH, qr, { width: 400 })
          .then(() => console.log(`QR_READY:${QR_IMAGE_PATH}`))
          .catch((err) => console.error("Errore nel salvataggio del QR:", err));
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as Boom | undefined)?.output
          ?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        console.log(
          loggedOut
            ? "Sessione WhatsApp disconnessa (logout). Cancella la cartella 'auth' e riavvia per un nuovo login."
            : "Connessione persa, tento la riconnessione..."
        );

        sock.ev.removeAllListeners("connection.update");
        sock.ev.removeAllListeners("messages.upsert");
        sock.ev.removeAllListeners("creds.update");

        if (!loggedOut) {
          setTimeout(start, reconnectDelayMs);
          reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
        }
      } else if (connection === "open") {
        reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
        console.log("Connesso a WhatsApp.");
        onOpen?.(ctx);
      }
    });

    // Async e non attesa dal chiamante (fire-and-forget, coerente con onMessage
    // qui sotto): l'eventuale trascrizione di un vocale non deve bloccare la
    // ricezione degli altri messaggi in arrivo nello stesso batch.
    async function handleIncomingMessage(msg: WAMessage): Promise<void> {
      // In una chat con se stessi, WhatsApp marca come "fromMe" anche i messaggi
      // scritti dal telefono: non possiamo usare questo flag per escludere i propri,
      // quindi distinguiamo i messaggi del bot tramite ownMessageIds.
      if (msg.key.id && ownMessageIds.has(msg.key.id)) return;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid) return;

      // L'assistente e' pensato per rispondere solo nella chat "con se stessi".
      // WhatsApp sta migrando verso identificativi "LID" (es. 123...@lid) al
      // posto del numero di telefono classico (@s.whatsapp.net): un messaggio
      // nella propria chat puo' arrivare sotto uno qualsiasi dei due formati
      // (sock.user.id vs sock.user.lid, numeri diversi per lo stesso account),
      // quindi si confronta con entrambi - stessa logica usata internamente da
      // Baileys per il proprio rilevamento "fromMe".
      const me = sock.user;
      const isSelfChat =
        !!me &&
        (areJidsSameUser(remoteJid, me.id) ||
          (!!me.lid && areJidsSameUser(remoteJid, me.lid)));

      if (!isSelfChat) {
        console.log(`Messaggio ignorato (chat diversa dalla propria: ${remoteJid})`);
        return;
      }

      let text = msg.message?.conversation ?? msg.message?.extendedTextMessage?.text;

      if (!text && msg.message?.audioMessage) {
        try {
          console.log(`Vocale ricevuto (da ${remoteJid}), trascrizione in corso...`);
          const audioBuffer = await downloadMediaMessage(msg, "buffer", {}, {
            logger,
            reuploadRequest: sock.updateMediaMessage,
          });
          const transcribed = await transcribeVoiceNote(audioBuffer);
          if (!transcribed) {
            console.log("Trascrizione vuota, vocale ignorato.");
            return;
          }
          // Non si inoltra subito: la trascrizione puo' sbagliare, quindi si
          // aspetta una conferma esplicita nel messaggio successivo (gestita
          // piu' sotto) prima di passarla all'orchestratore.
          pendingTranscriptions.set(remoteJid, transcribed);
          await ctx.send(
            remoteJid,
            `🎤 Ho capito: "${transcribed}"\n\nConfermi? Rispondi "sì" per procedere, oppure scrivi cosa intendevi davvero.`
          );
        } catch (err) {
          console.error("Errore nella trascrizione del vocale:", err);
          await ctx.send(remoteJid, "Non sono riuscito a capire il vocale, puoi riprovare o scrivere un messaggio di testo?");
        }
        return;
      }

      if (!text) return; // ignora ricevute/handshake senza testo

      const pending = pendingTranscriptions.get(remoteJid);
      if (pending !== undefined) {
        // Consumata subito, prima di ogni await successivo: due messaggi
        // ravvicinati sullo stesso jid non possono cosi' leggere due volte lo
        // stesso pending (stessa cautela della race condition gia' vista e
        // risolta il 16/08 per la history dell'orchestratore).
        pendingTranscriptions.delete(remoteJid);
        if (isConfirmation(text)) {
          text = pending;
        }
        // Altrimenti: la trascrizione in sospeso viene scartata e il nuovo
        // messaggio (una correzione scritta dall'utente, o tutt'altro) prosegue
        // normalmente qui sotto, come un messaggio qualunque.
      }

      console.log(`Messaggio ricevuto (da ${remoteJid}): ${text}`);
      onMessage?.(ctx, remoteJid, text);
    }

    sock.ev.on("messages.upsert", ({ messages }) => {
      for (const msg of messages) {
        void handleIncomingMessage(msg);
      }
    });
  }

  start();
}

export function getSelfJid(sock: WASocket): string {
  if (!sock.user) {
    throw new Error("Socket non ancora autenticato: nessun utente disponibile.");
  }
  return jidNormalizedUser(sock.user.id);
}
