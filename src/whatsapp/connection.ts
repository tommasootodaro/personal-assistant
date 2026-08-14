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

export async function connectWhatsApp(
  onOpen?: (sock: WASocket) => void
): Promise<WASocket> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

  const sock = makeWASocket({
    auth: state,
    logger,
  });

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
        connectWhatsApp(onOpen);
      }
    } else if (connection === "open") {
      console.log("Connesso a WhatsApp.");
      onOpen?.(sock);
    }
  });

  sock.ev.on("messages.upsert", ({ messages }) => {
    for (const msg of messages) {
      // In una chat con se stessi, WhatsApp marca come "fromMe" anche i messaggi
      // scritti dal telefono: non possiamo usare questo flag per escludere i propri.
      const text =
        msg.message?.conversation ?? msg.message?.extendedTextMessage?.text;
      if (!text) continue; // ignora ricevute/handshake senza testo
      console.log(`Messaggio ricevuto (da ${msg.key.remoteJid}): ${text}`);
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
