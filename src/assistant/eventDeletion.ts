import type { WhatsAppContext } from "../whatsapp/connection.js";
import type { GoogleAuthClient } from "../calendar/auth.js";
import {
  listUpcomingEvents,
  deleteEvent,
  type UpcomingEvent,
} from "../calendar/events.js";

interface PendingSelection {
  jid: string;
  events: UpcomingEvent[];
  selected: UpcomingEvent[];
}

let pending: PendingSelection | null = null;

function formatEventLine(event: UpcomingEvent): string {
  const date = new Date(event.start);
  const when = event.allDay
    ? date.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })
    : date.toLocaleString("it-IT", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
  return `${event.title} - ${when}`;
}

export async function sendEventList(
  ctx: WhatsAppContext,
  auth: GoogleAuthClient,
  jid: string,
  days = 14
): Promise<void> {
  const events = await listUpcomingEvents(auth, days);

  if (events.length === 0) {
    await ctx.send(jid, `Non ci sono eventi nei prossimi ${days} giorni.`);
    pending = null;
    return;
  }

  const lines = events.map((e, i) => `${i + 1}. ${formatEventLine(e)}`);
  await ctx.send(
    jid,
    `Eventi in arrivo:\n${lines.join("\n")}\n\nRispondi con i numeri da eliminare (es. "1" o "1,3").`
  );

  pending = { jid, events, selected: [] };
}

/**
 * Se c'e' una lista in attesa e il testo e' una selezione valida di numeri,
 * gestisce la richiesta e ritorna true. Altrimenti ritorna false, cosi'
 * il chiamante puo' passare il messaggio al normale parser di creazione eventi.
 */
export async function trySelectEvents(
  ctx: WhatsAppContext,
  jid: string,
  text: string
): Promise<boolean> {
  if (!pending || pending.jid !== jid) return false;

  const numbers = [
    ...new Set(
      text
        .split(/[,\s]+/)
        .map((part) => Number.parseInt(part, 10))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= pending!.events.length)
    ),
  ];

  if (numbers.length === 0) return false;

  const selected = numbers.map((n) => pending!.events[n - 1]);
  pending.selected = selected;

  const lines = selected.map((e) => `- ${formatEventLine(e)}`).join("\n");
  await ctx.send(jid, `Confermi l'eliminazione di:\n${lines}\n\nScrivi "conferma" per procedere.`);
  return true;
}

export function hasPendingDeletion(): boolean {
  return pending !== null && pending.selected.length > 0;
}

export async function confirmDeletion(
  ctx: WhatsAppContext,
  auth: GoogleAuthClient,
  jid: string
): Promise<void> {
  if (!pending || pending.selected.length === 0) {
    await ctx.send(jid, "Non c'e' nessuna selezione da confermare al momento.");
    return;
  }

  const toDelete = pending.selected;
  for (const event of toDelete) {
    await deleteEvent(auth, event.id);
  }

  await ctx.send(
    jid,
    `Eliminati ${toDelete.length} eventi:\n${toDelete.map((e) => `- ${formatEventLine(e)}`).join("\n")}`
  );
  pending = null;
}
