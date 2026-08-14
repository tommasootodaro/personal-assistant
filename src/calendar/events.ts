import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

export interface UpcomingEvent {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
}

export async function listUpcomingEvents(
  auth: OAuth2Client,
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
    title: event.summary ?? "(senza titolo)",
    start: event.start?.dateTime ?? event.start?.date ?? "",
    end: event.end?.dateTime ?? event.end?.date ?? "",
    allDay: Boolean(event.start?.date && !event.start?.dateTime),
  }));
}
