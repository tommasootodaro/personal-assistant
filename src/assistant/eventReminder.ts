import type { GoogleAuthClient } from "../google/auth.js";
import type { WhatsAppContext } from "../whatsapp/connection.js";
import { listUpcomingEvents, type UpcomingEvent } from "../calendar/events.js";

const TIME_ZONE = "Europe/Rome";
const EARLY_TOMORROW_HOUR = 10;

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function localKeyOf(date: Date): string {
  return date.toLocaleDateString("sv-SE", { timeZone: TIME_ZONE }); // sv-SE = formato YYYY-MM-DD
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  });
}

function formatEventLine(event: UpcomingEvent): string {
  const time = event.allDay ? "Tutto il giorno" : formatTime(event.start);
  return `- ${time}: ${event.title}`;
}

function startHour(event: UpcomingEvent): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(
      new Date(event.start)
    )
  );
}

export interface EventReminderDeps {
  googleAuth: GoogleAuthClient;
}

/**
 * Promemoria mattutino sugli impegni: gli eventi di oggi per intero, piu' quelli
 * di domani che iniziano presto (prima delle EARLY_TOMORROW_HOUR) - cosi' un
 * impegno mattiniero del giorno dopo si sa in anticipo, non solo quando arriva
 * il promemoria di quel giorno stesso (che potrebbe gia' essere tardi).
 * Ritorna null se non c'e' nulla di rilevante da segnalare (nessun invio quel giorno).
 */
export async function buildEventReminder(deps: EventReminderDeps): Promise<string | null> {
  const events = await listUpcomingEvents(deps.googleAuth, 2);
  if (events.length === 0) return null;

  const today = localKeyOf(new Date());
  const tomorrow = localKeyOf(new Date(Date.now() + 24 * 60 * 60 * 1000));

  const todayEvents = events.filter((e) => dayKey(e.start) === today);
  const earlyTomorrowEvents = events.filter(
    (e) => dayKey(e.start) === tomorrow && !e.allDay && startHour(e) < EARLY_TOMORROW_HOUR
  );

  if (todayEvents.length === 0 && earlyTomorrowEvents.length === 0) return null;

  const sections: string[] = [];
  if (todayEvents.length > 0) {
    sections.push(`Impegni di oggi:\n${todayEvents.map(formatEventLine).join("\n")}`);
  }
  if (earlyTomorrowEvents.length > 0) {
    sections.push(`Domani mattina presto hai anche:\n${earlyTomorrowEvents.map(formatEventLine).join("\n")}`);
  }

  return sections.join("\n\n");
}

export async function sendEventReminder(
  ctx: WhatsAppContext,
  jid: string,
  deps: EventReminderDeps
): Promise<void> {
  const text = await buildEventReminder(deps);
  if (text) await ctx.send(jid, text);
}
