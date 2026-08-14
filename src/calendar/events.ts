import { google } from "googleapis";
import type { GoogleAuthClient } from "../google/auth.js";
import { resolveColorId, type EventColorName } from "./colors.js";

export interface UpcomingEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
}

export async function listUpcomingEvents(
  auth: GoogleAuthClient,
  days: number
): Promise<UpcomingEvent[]> {
  const calendar = google.calendar({ version: "v3", auth });

  const now = new Date();
  const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const { data } = await calendar.events.list({
    calendarId: "primary",
    timeMin: now.toISOString(),
    timeMax: until.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
  });

  return (data.items ?? []).map((event) => ({
    id: event.id ?? "",
    title: event.summary ?? "(senza titolo)",
    start: event.start?.dateTime ?? event.start?.date ?? "",
    end: event.end?.dateTime ?? event.end?.date ?? "",
    allDay: Boolean(event.start?.date && !event.start?.dateTime),
  }));
}

export interface NewEvent {
  title: string;
  allDay: boolean;
  /**
   * Se allDay=false: data/ora ISO 8601, es. "2026-08-15T15:00:00".
   * Se allDay=true: solo data, es. "2026-08-15".
   */
  start: string;
  /**
   * Se allDay=false: data/ora ISO 8601 di fine.
   * Se allDay=true: ultima data INCLUSA nell'evento (es. "2026-08-15" per un evento di un giorno solo).
   */
  end: string;
  color?: EventColorName;
  timeZone?: string;
}

export interface CreatedEvent {
  id: string;
  htmlLink: string;
}

/** Google Calendar tratta la data di fine di un evento "tutto il giorno" come esclusiva. */
function nextDay(dateOnly: string): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function createEvent(
  auth: GoogleAuthClient,
  event: NewEvent
): Promise<CreatedEvent> {
  const calendar = google.calendar({ version: "v3", auth });
  const timeZone = event.timeZone ?? "Europe/Rome";

  const { data } = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: event.title,
      colorId: resolveColorId(event.color),
      start: event.allDay
        ? { date: event.start }
        : { dateTime: event.start, timeZone },
      end: event.allDay
        ? { date: nextDay(event.end) }
        : { dateTime: event.end, timeZone },
    },
  });

  return { id: data.id ?? "", htmlLink: data.htmlLink ?? "" };
}

export async function deleteEvent(
  auth: GoogleAuthClient,
  eventId: string
): Promise<void> {
  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.delete({ calendarId: "primary", eventId });
}
