import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { NewEvent } from "../calendar/events.js";
import { EVENT_COLORS, type EventColorName } from "../calendar/colors.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const COLOR_NAMES = Object.keys(EVENT_COLORS) as EventColorName[];

const CREATE_EVENT_TOOL: Anthropic.Tool = {
  name: "create_calendar_event",
  description:
    "Crea un evento sul calendario con i dettagli estratti dal messaggio dell'utente. Usalo solo se il messaggio descrive chiaramente un impegno con data (e opzionalmente ora).",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Titolo breve dell'evento" },
      all_day: {
        type: "boolean",
        description:
          "true se l'evento dura l'intera giornata (o più giorni) senza un orario preciso, false se ha un orario specifico.",
      },
      start: {
        type: "string",
        description:
          "Se all_day=false: data e ora di inizio, ISO 8601 senza timezone (es. 2026-08-15T15:00:00). Se all_day=true: solo la data di inizio (es. 2026-08-15).",
      },
      end: {
        type: "string",
        description:
          "Se all_day=false: data e ora di fine (se non specificata una durata, un'ora dopo l'inizio). Se all_day=true: ULTIMA data inclusa nell'evento (es. 2026-08-15 per un evento di un solo giorno, anche se non menzionata esplicitamente).",
      },
      color: {
        type: "string",
        enum: COLOR_NAMES,
        description:
          "Colore per classificare visivamente l'evento, solo se richiesto esplicitamente dall'utente. Scegli il nome più vicino a quello menzionato.",
      },
    },
    required: ["title", "all_day", "start", "end"],
  },
};

export type ParseResult =
  | { type: "event"; event: NewEvent }
  | { type: "clarification"; message: string };

export async function parseEventFromText(text: string): Promise<ParseResult> {
  const nowIso = new Date().toISOString();

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    system: `Sei un assistente che estrae impegni di calendario da messaggi in italiano. Data e ora attuali: ${nowIso} (fuso orario Europe/Rome). Se il messaggio descrive chiaramente un evento con data/ora (anche relativa, tipo "domani" o "venerdi' prossimo"), chiama lo strumento create_calendar_event. Se il messaggio e' ambiguo o mancano informazioni essenziali, rispondi con una breve domanda di chiarimento in italiano, senza chiamare lo strumento.`,
    tools: [CREATE_EVENT_TOOL],
    messages: [{ role: "user", content: text }],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );

  if (toolUse) {
    const input = toolUse.input as {
      title: string;
      all_day: boolean;
      start: string;
      end: string;
      color?: EventColorName;
    };
    return {
      type: "event",
      event: {
        title: input.title,
        allDay: input.all_day,
        start: input.start,
        end: input.end,
        color: input.color,
        timeZone: "Europe/Rome",
      },
    };
  }

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );

  return {
    type: "clarification",
    message:
      textBlock?.text ?? "Non ho capito che evento vuoi creare, puoi essere piu' specifico?",
  };
}
