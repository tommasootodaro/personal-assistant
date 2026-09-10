import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { ClassifiedEmail } from "./classify.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const DETAILED_DIGEST_TOOL: Anthropic.Tool = {
  name: "submit_detailed_digest",
  description: "Restituisce, per ciascuna newsletter fornita, la lista degli articoli/argomenti trattati.",
  input_schema: {
    type: "object",
    properties: {
      digests: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            items: {
              type: "array",
              items: { type: "string" },
              description:
                "Un bullet breve per ciascun articolo/argomento distinto (argomento + dettaglio chiave), max 15-20 parole ciascuno.",
            },
          },
          required: ["id", "items"],
        },
      },
    },
    required: ["digests"],
  },
};

export interface DetailedDigestEmail extends ClassifiedEmail {
  items: string[];
}

const DETAILED_MAX_CONTENT_CHARS = 6000;

/** Riassunto articolo-per-articolo, per newsletter con più contenuti distinti (es. TLDR). */
export async function summarizeDetailed(emails: ClassifiedEmail[]): Promise<DetailedDigestEmail[]> {
  if (emails.length === 0) return [];

  const input = emails.map((e) => ({
    id: e.id,
    from: `${e.senderName} <${e.senderEmail}>`,
    subject: e.subject,
    content: (e.bodyText || e.snippet).slice(0, DETAILED_MAX_CONTENT_CHARS),
  }));

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 3000,
    system:
      "Per ciascuna newsletter fornita, elenca in italiano gli articoli/argomenti distinti che tratta (tipicamente 4-8), uno per bullet, chiamando submit_detailed_digest. Ogni bullet: argomento + il dettaglio chiave in una riga (max 15-20 parole), cosi' l'utente capisce di cosa si parla e puo' decidere se approfondire da solo. Ignora sponsor/pubblicita' e sezioni promozionali. Nessun bullet ridondante.",
    tools: [DETAILED_DIGEST_TOOL],
    tool_choice: { type: "tool", name: "submit_detailed_digest" },
    messages: [{ role: "user", content: JSON.stringify(input) }],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  const digests =
    (toolUse?.input as { digests: { id: string; items: string[] }[] } | undefined)?.digests ?? [];
  const digestMap = new Map(digests.map((d) => [d.id, d.items]));

  return emails.map((e) => ({ ...e, items: digestMap.get(e.id) ?? [] }));
}
