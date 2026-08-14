import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
} from "baileys";
import type { WASocket } from "baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcodeTerminal from "qrcode-terminal";
import QRCode from "qrcode";
import path from "node:path";

const AUTH_FOLDER = "auth";
const QR_IMAGE_PATH = path.resolve(process.cwd(), "whatsapp-qr.png");

const logger = pino({ level: "silent" });

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

export async function connectWhatsApp(
  onOpen?: (ctx: WhatsAppContext) => void,
  onMessage?: MessageHandler
): Promise<WASocket> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const ownMessageIds = new Set<string>();

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

      if (!loggedOut) {
        connectWhatsApp(onOpen, onMessage);
      }
    } else if (connection === "open") {
      console.log("Connesso a WhatsApp.");
      onOpen?.(ctx);
    }
  });

  sock.ev.on("messages.upsert", ({ messages }) => {
    for (const msg of messages) {
      // In una chat con se stessi, WhatsApp marca come "fromMe" anche i messaggi
      // scritti dal telefono: non possiamo usare questo flag per escludere i propri,
      // quindi distinguiamo i messaggi del bot tramite ownMessageIds.
      if (msg.key.id && ownMessageIds.has(msg.key.id)) continue;

      const text =
        msg.message?.conversation ?? msg.message?.extendedTextMessage?.text;
      if (!text) continue; // ignora ricevute/handshake senza testo
      const remoteJid = msg.key.remoteJid;
      console.log(`Messaggio ricevuto (da ${remoteJid}): ${text}`);
      if (remoteJid) {
        onMessage?.(ctx, remoteJid, text);
      }
    }
  });

  return sock;
}

export function getSelfJid(sock: WASocket): string {
  if (!sock.user) {
    throw new Error("Socket non ancora autenticato: nessun utente disponibile.");
  }
  return jidNormalizedUser(sock.user.id);
}
