import type { GoogleAuthClient } from "../google/auth.js";
import type { WhatsAppContext } from "../whatsapp/connection.js";
import { listUpcomingEvents, type UpcomingEvent } from "../calendar/events.js";
import { getTldrDigestText } from "../email/digest.js";

const DAYS_AHEAD = 7;
const TIME_ZONE = "Europe/Rome";

/** Chiave "YYYY-MM-DD" nel fuso locale dell'utente, sia per eventi con orario che "tutto il giorno". */
function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function todayKey(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: TIME_ZONE }); // sv-SE = formato YYYY-MM-DD
}

function formatEventLine(event: UpcomingEvent): string {
  const time = event.allDay
    ? "Tutto il giorno"
    : new Date(event.start).toLocaleTimeString("it-IT", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: TIME_ZONE,
      });
  return `- ${time}: ${event.title}`;
}

function formatDayLabel(key: string, today: string): string {
  if (key === today) return "Oggi";
  return new Date(`${key}T12:00:00`).toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: TIME_ZONE,
  });
}

function formatCalendarSection(events: UpcomingEvent[]): string {
  if (events.length === 0) return `Nessun impegno nei prossimi ${DAYS_AHEAD} giorni.`;

  const today = todayKey();
  const byDay = new Map<string, UpcomingEvent[]>();
  for (const event of events) {
    const key = dayKey(event.start);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(event);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, dayEvents]) => `${formatDayLabel(key, today)}:\n${dayEvents.map(formatEventLine).join("\n")}`)
    .join("\n\n");
}

export interface MorningDigestDeps {
  googleAuth: GoogleAuthClient;
}

export async function buildMorningDigest(deps: MorningDigestDeps): Promise<string> {
  const [events, tldr] = await Promise.all([
    listUpcomingEvents(deps.googleAuth, DAYS_AHEAD),
    getTldrDigestText(deps.googleAuth),
  ]);

  return `Ecco il riepilogo di oggi.\n\nIMPEGNI\n${formatCalendarSection(events)}\n\nTLDR\n${tldr}`;
}

export async function sendMorningDigest(
  ctx: WhatsAppContext,
  jid: string,
  deps: MorningDigestDeps
): Promise<void> {
  const text = await buildMorningDigest(deps);
  await ctx.send(jid, text);
}
