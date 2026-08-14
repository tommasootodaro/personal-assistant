import { google, gmail_v1 } from "googleapis";
import type { GoogleAuthClient } from "../google/auth.js";

export interface FetchedEmail {
  id: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  date: string;
  snippet: string;
  bodyText: string;
  hasListUnsubscribe: boolean;
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function parseSender(fromHeader: string): { name: string; email: string } {
  const match = fromHeader.match(/^(.*)<(.+)>$/);
  if (match) {
    return {
      name: match[1].trim().replace(/^"|"$/g, ""),
      email: match[2].trim().toLowerCase(),
    };
  }
  return { name: fromHeader.trim(), email: fromHeader.trim().toLowerCase() };
}

function extractPlainText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }

  if (payload.parts) {
    const directTextPart = payload.parts.find((p) => p.mimeType === "text/plain" && p.body?.data);
    if (directTextPart?.body?.data) {
      return Buffer.from(directTextPart.body.data, "base64url").toString("utf-8");
    }
    for (const part of payload.parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
  }

  return "";
}

export async function fetchRecentEmails(auth: GoogleAuthClient, hours: number): Promise<FetchedEmail[]> {
  const gmail = google.gmail({ version: "v1", auth });
  const days = Math.max(1, Math.ceil(hours / 24));

  const { data: listData } = await gmail.users.messages.list({
    userId: "me",
    q: `newer_than:${days}d in:inbox`,
    maxResults: 100,
  });

  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const messageRefs = listData.messages ?? [];

  const emails = await Promise.all(
    messageRefs.map(async (ref): Promise<FetchedEmail | null> => {
      const { data } = await gmail.users.messages.get({
        userId: "me",
        id: ref.id!,
        format: "full",
      });

      const internalDate = Number(data.internalDate ?? "0");
      if (internalDate < cutoff) return null;

      const headers = data.payload?.headers;
      const { name, email } = parseSender(getHeader(headers, "From"));

      return {
        id: data.id ?? ref.id ?? "",
        senderName: name,
        senderEmail: email,
        subject: getHeader(headers, "Subject") || "(senza oggetto)",
        date: new Date(internalDate).toISOString(),
        snippet: data.snippet ?? "",
        bodyText: extractPlainText(data.payload),
        hasListUnsubscribe: Boolean(getHeader(headers, "List-Unsubscribe")),
      };
    })
  );

  return emails
    .filter((e): e is FetchedEmail => e !== null)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
