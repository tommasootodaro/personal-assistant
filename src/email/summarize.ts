import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { ClassifiedEmail } from "./classify.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const SUMMARIZE_TOOL: Anthropic.Tool = {
  name: "submit_summaries",
  description: "Restituisce un riassunto per ciascuna mail fornita, nello stesso ordine e con lo stesso id.",
  input_schema: {
    type: "object",
    properties: {
      summaries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            summary: { type: "string" },
          },
          required: ["id", "summary"],
        },
      },
    },
    required: ["summaries"],
  },
};

export interface SummarizedEmail extends ClassifiedEmail {
  summary: string;
}

const MAX_CONTENT_CHARS = 3000;

export async function summarizeEmails(emails: ClassifiedEmail[]): Promise<SummarizedEmail[]> {
  if (emails.length === 0) return [];

  const input = emails.map((e) => ({
    id: e.id,
    from: `${e.senderName} <${e.senderEmail}>`,
    subject: e.subject,
    newsletter: e.isNewsletter,
    content: (e.bodyText || e.snippet).slice(0, MAX_CONTENT_CHARS),
  }));

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 3000,
    system:
      "Riassumi ciascuna mail fornita, in italiano, chiamando submit_summaries. Per le mail con newsletter=true sii estremamente compatto (max 15-20 parole, solo l'essenziale, niente dettagli secondari). Per le altre, 1-2 frasi che catturino il contenuto principale e eventuali azioni richieste. Nessun saluto o preambolo, vai dritto al contenuto.",
    tools: [SUMMARIZE_TOOL],
    tool_choice: { type: "tool", name: "submit_summaries" },
    messages: [{ role: "user", content: JSON.stringify(input) }],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  const summaries =
    (toolUse?.input as { summaries: { id: string; summary: string }[] } | undefined)?.summaries ?? [];
  const summaryMap = new Map(summaries.map((s) => [s.id, s.summary]));

  return emails.map((e) => ({ ...e, summary: summaryMap.get(e.id) ?? e.snippet }));
}
