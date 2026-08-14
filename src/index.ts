import { connectWhatsApp, getSelfJid } from "./whatsapp/connection.js";
import { getAuthenticatedClient } from "./google/auth.js";
import { createEvent } from "./calendar/events.js";
import { parseEventFromText } from "./assistant/parseEvent.js";
import {
  sendEventList,
  trySelectEvents,
  confirmDeletion,
  hasPendingDeletion,
} from "./assistant/eventDeletion.js";

const SHOW_EVENTS_TRIGGERS = ["i miei eventi", "mostrami i miei eventi", "i miei impegni"];
const CONFIRM_WORDS = ["conferma", "si", "sì", "ok"];

async function main() {
  console.log("Personal Assistant: autenticazione Google Calendar...");
  const calendarAuth = await getAuthenticatedClient();
  console.log("Google Calendar autenticato.");

  console.log("Personal Assistant: avvio connessione WhatsApp...");

  await connectWhatsApp(
    async (ctx) => {
      const selfJid = getSelfJid(ctx.sock);
      await ctx.send(
        selfJid,
        'Assistente collegato. Scrivimi un impegno (es. "domani alle 15 dentista") per aggiungerlo al calendario, oppure "i miei eventi" per vederli ed eventualmente eliminarli.'
      );
    },
    async (ctx, remoteJid, text) => {
      const normalized = text.trim().toLowerCase();

      try {
        if (CONFIRM_WORDS.includes(normalized) && hasPendingDeletion()) {
          await confirmDeletion(ctx, calendarAuth, remoteJid);
          return;
        }

        if (SHOW_EVENTS_TRIGGERS.some((trigger) => normalized.includes(trigger))) {
          await sendEventList(ctx, calendarAuth, remoteJid);
          return;
        }

        if (await trySelectEvents(ctx, remoteJid, text)) {
          return;
        }

        const result = await parseEventFromText(text);

        if (result.type === "event") {
          const created = await createEvent(calendarAuth, result.event);
          await ctx.send(
            remoteJid,
            `Evento creato: "${result.event.title}" (${result.event.start} - ${result.event.end}).\n${created.htmlLink}`
          );
        } else {
          await ctx.send(remoteJid, result.message);
        }
      } catch (err) {
        console.error("Errore nella gestione del messaggio:", err);
        await ctx.send(remoteJid, "Si e' verificato un errore, riprova.");
      }
    }
  );
}

main().catch((err) => {
  console.error("Errore durante l'avvio:", err);
  process.exit(1);
});
