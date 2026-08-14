import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { WhatsAppContext } from "../whatsapp/connection.js";
import type { GoogleAuthClient } from "../google/auth.js";
import { loadNotes, searchNotes } from "../vault/search.js";
import { listUpcomingEvents, createEvent, deleteEvent } from "../calendar/events.js";
import { EVENT_COLORS, type EventColorName } from "../calendar/colors.js";
import { getTldrDigestText } from "../email/digest.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });
const COLOR_NAMES = Object.keys(EVENT_COLORS) as EventColorName[];

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_vault",
    description:
      "Cerca nelle note del vault Obsidian (la knowledge base personale dell'utente) per parola chiave. Usalo quando l'utente chiede cosa sa o ha scritto su un argomento.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Termini di ricerca" } },
      required: ["query"],
    },
  },
  {
    name: "list_calendar_events",
    description:
      "Elenca gli eventi del calendario nei prossimi N giorni, con i relativi id (necessari per eliminarli in seguito).",
    input_schema: {
      type: "object",
      properties: { days: { type: "number", description: "Quanti giorni in avanti guardare (default 14)" } },
      required: [],
    },
  },
  {
    name: "create_calendar_event",
    description: "Crea un evento sul calendario.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        all_day: { type: "boolean" },
        start: {
          type: "string",
          description:
            "Se all_day=false: data e ora di inizio, ISO 8601 senza timezone (es. 2026-08-15T15:00:00). Se all_day=true: solo la data (es. 2026-08-15).",
        },
        end: {
          type: "string",
          description:
            "Se all_day=false: data e ora di fine. Se all_day=true: ULTIMA data inclusa nell'evento (es. 2026-08-15 per un evento di un solo giorno).",
        },
        color: { type: "string", enum: COLOR_NAMES, description: "Solo se richiesto esplicitamente dall'utente." },
      },
      required: ["title", "all_day", "start", "end"],
    },
  },
  {
    name: "delete_calendar_events",
    description:
      "Elimina uno o piu' eventi dal calendario, dato il loro id. USA QUESTO STRUMENTO SOLO DOPO che l'utente ha confermato esplicitamente quali eventi eliminare (mostragli prima la lista con list_calendar_events e attendi la sua conferma nel messaggio successivo).",
    input_schema: {
      type: "object",
      properties: { event_ids: { type: "array", items: { type: "string" } } },
      required: ["event_ids"],
    },
  },
  {
    name: "get_tldr_digest",
    description: "Recupera e riassume, articolo per articolo, le newsletter TLDR ricevute nelle ultime 24 ore.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

function systemPrompt(): string {
  const nowIso = new Date().toISOString();
  return `Sei l'assistente personale dell'utente su WhatsApp. Data e ora attuali: ${nowIso} (fuso orario Europe/Rome). Rispondi sempre in italiano, in modo diretto e conciso: sei su WhatsApp, evita formattazione elaborata o markdown pesante.

Hai strumenti per: cercare nel vault Obsidian (la sua knowledge base personale), leggere/creare/eliminare eventi sul Google Calendar, e ottenere il digest delle newsletter TLDR.

Regole importanti:
- Per eliminare eventi: prima chiama list_calendar_events e mostra la lista pertinente all'utente, chiedendo quali eliminare. Chiama delete_calendar_events SOLO dopo che l'utente ha confermato esplicitamente in un messaggio (il suo, non il tuo). Non eliminare mai eventi senza conferma esplicita.
- Se una richiesta e' ambigua (es. data/ora mancante per un evento), fai una domanda di chiarimento invece di indovinare.
- Se una ricerca nel vault non trova nulla di pertinente, dillo chiaramente invece di inventare contenuti.`;
}

export interface OrchestratorDeps {
  googleAuth: GoogleAuthClient;
}

async function executeTool(name: string, input: Record<string, unknown>, deps: OrchestratorDeps): Promise<string> {
  switch (name) {
    case "search_vault": {
      const notes = await loadNotes(config.obsidianVaultPath);
      const results = searchNotes(String(input.query ?? ""), notes);
      if (results.length === 0) return "Nessuna nota pertinente trovata.";
      return results.map((r) => `### ${r.note.title}\n${r.excerpt}`).join("\n\n");
    }

    case "list_calendar_events": {
      const days = typeof input.days === "number" ? input.days : 14;
      const events = await listUpcomingEvents(deps.googleAuth, days);
      if (events.length === 0) return `Nessun evento nei prossimi ${days} giorni.`;
      return events
        .map((e) => `id=${e.id} | ${e.title} | ${e.start} -> ${e.end}${e.allDay ? " (tutto il giorno)" : ""}`)
        .join("\n");
    }

    case "create_calendar_event": {
      const created = await createEvent(deps.googleAuth, {
        title: String(input.title),
        allDay: Boolean(input.all_day),
        start: String(input.start),
        end: String(input.end),
        color: input.color as EventColorName | undefined,
        timeZone: "Europe/Rome",
      });
      return `Evento creato: ${created.htmlLink}`;
    }

    case "delete_calendar_events": {
      const ids = Array.isArray(input.event_ids) ? (input.event_ids as string[]) : [];
      for (const id of ids) await deleteEvent(deps.googleAuth, id);
      return `Eliminati ${ids.length} eventi.`;
    }

    case "get_tldr_digest":
      return getTldrDigestText(deps.googleAuth);

    default:
      return `Strumento sconosciuto: ${name}`;
  }
}

type History = Anthropic.MessageParam[];
const histories = new Map<string, History>();
const MAX_HISTORY_MESSAGES = 20;
const MAX_TOOL_TURNS = 6;
const OMITTED_TOOL_RESULT_PLACEHOLDER =
  "[risultato omesso per contenere i costi — l'informazione rilevante e' gia' nella risposta testuale di quel turno]";

/**
 * I risultati dei tool (es. il digest TLDR, liste eventi) possono essere corposi.
 * Una volta che un turno e' concluso, il loro contenuto e' gia' riassunto nella
 * risposta testuale mandata all'utente: per i turni precedenti a quello appena
 * concluso li sostituiamo con un placeholder, cosi' non vengono ripagati ad ogni
 * messaggio successivo. Il turno appena concluso resta intatto (potrebbe servire
 * per un follow-up immediato, es. la conferma di un'eliminazione).
 */
function compactOldToolResults(messages: History, keepFromIndex: number): History {
  return messages.map((message, i) => {
    if (i >= keepFromIndex || message.role !== "user" || !Array.isArray(message.content)) {
      return message;
    }
    const content = message.content.map((block) =>
      block.type === "tool_result" ? { ...block, content: OMITTED_TOOL_RESULT_PLACEHOLDER } : block
    );
    return { ...message, content };
  });
}

export async function handleMessage(
  ctx: WhatsAppContext,
  jid: string,
  text: string,
  deps: OrchestratorDeps
): Promise<void> {
  const priorHistoryLength = (histories.get(jid) ?? []).length;
  let messages: History = [...(histories.get(jid) ?? []), { role: "user", content: text }];

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: systemPrompt(),
      tools: TOOLS,
      messages,
    });

    messages = [...messages, { role: "assistant", content: response.content }];

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (toolUses.length === 0) {
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      await ctx.send(jid, textBlock?.text ?? "Non ho una risposta al momento.");
      const compacted = compactOldToolResults(messages, priorHistoryLength);
      histories.set(jid, compacted.slice(-MAX_HISTORY_MESSAGES));
      return;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      let content: string;
      let isError = false;
      try {
        content = await executeTool(toolUse.name, toolUse.input as Record<string, unknown>, deps);
      } catch (err) {
        content = `Errore nell'esecuzione dello strumento: ${err instanceof Error ? err.message : String(err)}`;
        isError = true;
      }
      toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content, is_error: isError });
    }

    messages = [...messages, { role: "user", content: toolResults }];
  }

  await ctx.send(jid, "Non sono riuscito a completare la richiesta (troppi passaggi), riprova con un messaggio più semplice.");
  const compacted = compactOldToolResults(messages, priorHistoryLength);
  histories.set(jid, compacted.slice(-MAX_HISTORY_MESSAGES));
}
