import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { WhatsAppContext } from "../whatsapp/connection.js";
import { isAuthExpiredError, type GoogleAuthClient } from "../google/auth.js";
import { loadNotes, searchNotes } from "../vault/search.js";
import { saveIdea, deleteIdea, IDEA_CATEGORIES, IDEA_TYPES, type IdeaCategory, type IdeaType } from "../vault/ideas.js";
import { listUpcomingEvents, createEvent, deleteEvent, updateEventDescription } from "../calendar/events.js";
import { EVENT_COLORS, type EventColorName } from "../calendar/colors.js";
import { getTldrDigestText } from "../email/digest.js";
import { requestCreditWidgetRefresh } from "../creditWidget.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });
const COLOR_NAMES = Object.keys(EVENT_COLORS) as EventColorName[];
/**
 * list_calendar_events guarda anche un po' indietro nel passato, non solo in
 * avanti: senza questo, un evento di ieri (es. da spostare a domani) non
 * comparirebbe nella lista e il bot non riuscirebbe a trovarne l'id.
 */
const CALENDAR_DAYS_BACK = 3;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_vault",
    description:
      "Cerca nelle note del vault Obsidian (la knowledge base personale dell'utente) per parola chiave. Usalo quando l'utente chiede cosa sa o ha scritto su un argomento, oppure per trovare un'idea da eliminare (vedi delete_ideas). Il risultato include il percorso relativo di ogni nota, da riusare tale e quale per delete_ideas.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Termini di ricerca" } },
      required: ["query"],
    },
  },
  {
    name: "list_calendar_events",
    description:
      `Elenca gli eventi del calendario nei prossimi N giorni (e negli ultimi ${CALENDAR_DAYS_BACK} giorni, cosi' un evento appena passato resta trovabile per spostarlo o eliminarlo), con i relativi id (necessari per eliminarli in seguito).`,
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
        description: {
          type: "string",
          description: "Note dell'evento: testo libero, link, dettagli aggiuntivi. Opzionale.",
        },
      },
      required: ["title", "all_day", "start", "end"],
    },
  },
  {
    name: "update_calendar_event_notes",
    description:
      "Aggiunge o sostituisce le note (descrizione) di un evento gia' esistente sul calendario, dato il suo id (usa list_calendar_events per trovarlo). Utile per incollare link o altre informazioni su un evento gia' creato.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
        description: { type: "string", description: "Nuovo testo delle note (sostituisce quello esistente)." },
      },
      required: ["event_id", "description"],
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
  {
    name: "save_idea",
    description:
      "Salva un'idea o un pensiero al volo come nota singola nel vault Obsidian (dentro 'Idee/<categoria>/'), aggiungendola anche all'indice 'Idee/Inbox.md'. Usalo quando l'utente vuole segnarsi/appuntarsi qualcosa (es. 'segnati questa idea:', 'appuntami che...'). NON usarlo per eventi con data/ora (usa create_calendar_event) ne' per domande.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Titolo breve (3-6 parole) dell'idea, usato anche come nome del file della nota.",
        },
        category: {
          type: "string",
          enum: [...IDEA_CATEGORIES],
          description: "Macro-categoria dell'idea, per organizzare il vault in sottocartelle. Usa 'Altro' se nessuna calza bene.",
        },
        type: {
          type: "string",
          enum: [...IDEA_TYPES],
          description:
            "'startup' se l'idea descrive un potenziale prodotto/servizio/business su cui si potrebbe costruire un'azienda; 'spunto' se e' un pensiero, appunto o miglioramento piu' casuale, non pensato come business.",
        },
        text: {
          type: "string",
          description: "Il testo dell'idea, cosi' come l'ha espressa l'utente (puoi ripulirlo leggermente ma senza alterarne il senso).",
        },
      },
      required: ["title", "category", "type", "text"],
    },
  },
  {
    name: "delete_ideas",
    description:
      "Elimina una o piu' idee dal vault Obsidian, dato il loro percorso relativo (usa search_vault per trovarle, es. \"Idee/AI/2026-08-15 Titolo.md\"). USA QUESTO STRUMENTO SOLO DOPO che l'utente ha confermato esplicitamente quali idee eliminare (mostragli prima i risultati di search_vault e attendi la sua conferma nel messaggio successivo). Non eliminare mai idee senza conferma esplicita.",
    input_schema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Percorsi relativi al vault delle idee da eliminare, cosi' come restituiti da search_vault.",
        },
      },
      required: ["paths"],
    },
  },
];

function systemPrompt(): string {
  const nowIso = new Date().toISOString();
  return `Sei l'assistente personale dell'utente su WhatsApp. Data e ora attuali: ${nowIso} (fuso orario Europe/Rome). Rispondi sempre in italiano, in modo diretto e conciso: sei su WhatsApp, evita formattazione elaborata o markdown pesante.

Hai strumenti per: cercare nel vault Obsidian (la sua knowledge base personale), leggere/creare/eliminare eventi sul Google Calendar (anche con note, link o altri dettagli), aggiungere o modificare le note di un evento gia' esistente, ottenere il digest delle newsletter TLDR, salvare rapidamente idee/appunti nel vault ed eliminarli.

Regole importanti:
- Per eliminare eventi: prima chiama list_calendar_events e mostra la lista pertinente all'utente, chiedendo quali eliminare. Chiama delete_calendar_events SOLO dopo che l'utente ha confermato esplicitamente in un messaggio (il suo, non il tuo). Non eliminare mai eventi senza conferma esplicita.
- Per eliminare idee: prima chiama search_vault per trovare le idee pertinenti e mostrale all'utente con il loro percorso. Chiama delete_ideas SOLO dopo conferma esplicita in un messaggio successivo, con la stessa cautela usata per gli eventi calendario. Non eliminare mai idee senza conferma esplicita.
- Se una richiesta e' ambigua (es. data/ora mancante per un evento), fai una domanda di chiarimento invece di indovinare.
- Se una ricerca nel vault non trova nulla di pertinente, dillo chiaramente invece di inventare contenuti.
- Se l'utente ti chiede di creare piu' eventi in un colpo solo, chiama create_calendar_event piu' volte nello stesso turno invece di uno per turno, e alla fine riepiloga quanti ne hai creati.
- Se l'utente vuole segnarsi un'idea o un pensiero (senza data/ora specifica), usa save_idea. Se invece descrive qualcosa da fare in un momento preciso, e' un evento calendario (create_calendar_event).`;
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
      return results
        .map((r) => {
          const relativePath = path.relative(config.obsidianVaultPath, r.note.filePath).replace(/\\/g, "/");
          return `### ${r.note.title} (${relativePath})\n${r.excerpt}`;
        })
        .join("\n\n");
    }

    case "list_calendar_events": {
      const days = typeof input.days === "number" ? input.days : 14;
      const events = await listUpcomingEvents(deps.googleAuth, days, CALENDAR_DAYS_BACK);
      if (events.length === 0) return `Nessun evento negli ultimi ${CALENDAR_DAYS_BACK} giorni ne' nei prossimi ${days}.`;
      return events
        .map((e) => {
          const notes = e.description ? ` | note: ${e.description}` : "";
          return `id=${e.id} | ${e.title} | ${e.start} -> ${e.end}${e.allDay ? " (tutto il giorno)" : ""}${notes}`;
        })
        .join("\n");
    }

    case "create_calendar_event": {
      const created = await createEvent(deps.googleAuth, {
        title: String(input.title),
        allDay: Boolean(input.all_day),
        start: String(input.start),
        end: String(input.end),
        color: input.color as EventColorName | undefined,
        description: typeof input.description === "string" ? input.description : undefined,
        timeZone: "Europe/Rome",
      });
      return `Evento creato: ${created.htmlLink}`;
    }

    case "update_calendar_event_notes": {
      const eventId = String(input.event_id ?? "");
      if (!eventId) return "Nessun event_id fornito.";
      await updateEventDescription(deps.googleAuth, eventId, String(input.description ?? ""));
      return "Note aggiornate.";
    }

    case "delete_calendar_events": {
      const ids = Array.isArray(input.event_ids) ? (input.event_ids as string[]) : [];
      for (const id of ids) await deleteEvent(deps.googleAuth, id);
      return `Eliminati ${ids.length} eventi.`;
    }

    case "get_tldr_digest":
      return getTldrDigestText(deps.googleAuth);

    case "save_idea": {
      const text = String(input.text ?? "").trim();
      if (!text) return "Nessun testo fornito per l'idea.";
      const category = (IDEA_CATEGORIES as readonly string[]).includes(String(input.category))
        ? (input.category as IdeaCategory)
        : "Altro";
      const type = (IDEA_TYPES as readonly string[]).includes(String(input.type))
        ? (input.type as IdeaType)
        : "spunto";
      await saveIdea(config.obsidianVaultPath, {
        title: String(input.title ?? "Idea").trim() || "Idea",
        category,
        type,
        text,
      });
      return `Idea salvata in Idee/${category}/ (${type}).`;
    }

    case "delete_ideas": {
      const paths = Array.isArray(input.paths) ? (input.paths as string[]) : [];
      for (const p of paths) await deleteIdea(config.obsidianVaultPath, p);
      return `Eliminate ${paths.length} idee.`;
    }

    default:
      return `Strumento sconosciuto: ${name}`;
  }
}

type History = Anthropic.MessageParam[];
const histories = new Map<string, History>();
const MAX_HISTORY_MESSAGES = 20;
// Una richiesta in blocco ("aggiungi tutte le scadenze del semestre") vale
// facilmente 20-25 create_calendar_event. Con 1500 token di output il modello
// veniva troncato a meta' di un tool_use, e con 6 turni finiva i giri prima di
// aver creato tutti gli eventi: entrambi i limiti erano tarati su richieste da
// uno o due eventi alla volta.
const MAX_TOOL_TURNS = 12;
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

/**
 * Un turno con i tool aggiunge SEMPRE due messaggi in coppia: l'`assistant` che
 * chiede il tool (`tool_use`) e lo `user` che ne riporta l'esito (`tool_result`).
 * Un `slice(-N)` secco puo' tagliare esattamente in mezzo a quella coppia e
 * lasciare in testa alla history dei `tool_result` orfani: l'API li rifiuta con
 * 400 ("unexpected `tool_use_id` found in `tool_result` blocks"), e siccome la
 * history rotta resta memorizzata, da quel momento OGNI messaggio successivo di
 * quella chat fallisce allo stesso modo finche' il servizio non viene riavviato
 * (causa reale del "Si e' verificato un errore, riprova." del 07/09/2026).
 * Dopo il taglio scartiamo quindi dalla testa finche' il primo messaggio non e'
 * un inizio di conversazione valido, cioe' uno `user` senza `tool_result`.
 */
function startsMidToolExchange(message: Anthropic.MessageParam): boolean {
  if (message.role === "assistant") return true;
  return (
    Array.isArray(message.content) &&
    message.content.some((block) => block.type === "tool_result")
  );
}

export function trimHistory(messages: History): History {
  let trimmed = messages.slice(-MAX_HISTORY_MESSAGES);
  while (trimmed.length > 0 && startsMidToolExchange(trimmed[0]!)) {
    trimmed = trimmed.slice(1);
  }
  return trimmed;
}

// connectWhatsApp() invoca onMessage per ogni messaggio senza attendere che il
// precedente sia stato gestito: se l'utente manda due messaggi ravvicinati (es.
// una richiesta e poi la conferma, prima che la prima risposta sia pronta) le
// due chiamate partirebbero in parallelo e leggerebbero entrambe la stessa
// `histories.get(jid)` di partenza, perdendo il turno intermedio (es. la lista
// di eventi appena mostrata) invece di vederlo nella history. Questa coda
// serializza le chiamate per jid così ogni messaggio vede sempre lo stato
// lasciato dal precedente; un errore in un turno non blocca i successivi.
const processingQueues = new Map<string, Promise<void>>();

export function handleMessage(
  ctx: WhatsAppContext,
  jid: string,
  text: string,
  deps: OrchestratorDeps
): Promise<void> {
  const previousTail = processingQueues.get(jid) ?? Promise.resolve();
  const thisCall = previousTail.catch(() => {}).then(() => processMessage(ctx, jid, text, deps));
  processingQueues.set(jid, thisCall.catch(() => {}));
  return thisCall;
}

function isBadRequest(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { status?: unknown }).status === 400;
}

async function processMessage(
  ctx: WhatsAppContext,
  jid: string,
  text: string,
  deps: OrchestratorDeps
): Promise<void> {
  // Il refresh del widget crediti va segnalato una volta sola per messaggio,
  // qualunque sia il modo in cui questa funzione esce (risposta diretta,
  // troppi passaggi, o un errore che risale al chiamante): centralizzato qui
  // invece che ripetuto ad ogni punto di uscita.
  try {
    try {
      await runTurn(ctx, jid, text, deps);
    } catch (err) {
      // Rete di sicurezza per il caso descritto in trimHistory(): se la history
      // salvata e' comunque diventata invalida, senza questo ramo resterebbe in
      // memoria a far fallire con 400 ogni messaggio futuro di questa chat.
      // Buttarla e riprovare fa perdere il contesto precedente, non l'assistente.
      if (!isBadRequest(err) || !histories.has(jid)) throw err;
      console.error(
        `History non valida per ${jid}: la azzero e riprovo una volta.`,
        err instanceof Error ? err.message : err
      );
      histories.delete(jid);
      await runTurn(ctx, jid, text, deps);
    }
  } finally {
    requestCreditWidgetRefresh();
  }
}

async function runTurn(
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
      max_tokens: 8000,
      system: systemPrompt(),
      tools: TOOLS,
      messages,
    });

    // Con stop_reason "max_tokens" l'ultimo blocco e' tagliato a meta'. Se e' un
    // tool_use, l'SDK lo consegna comunque con l'input JSON incompleto: eseguirlo
    // creerebbe un evento sbagliato (titolo mozzato, data mancante) invece di
    // fallire. Ci fermiamo prima di appendere il turno troncato, cosi' la history
    // salvata non resta con un tool_use privo del suo tool_result.
    if (response.stop_reason === "max_tokens") {
      await ctx.send(
        jid,
        "La richiesta e' troppo lunga per gestirla in un colpo solo: prova a spezzarla in due o tre messaggi."
      );
      histories.set(jid, trimHistory(compactOldToolResults(messages, priorHistoryLength)));
      return;
    }

    messages = [...messages, { role: "assistant", content: response.content }];

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (toolUses.length === 0) {
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      await ctx.send(jid, textBlock?.text ?? "Non ho una risposta al momento.");
      histories.set(jid, trimHistory(compactOldToolResults(messages, priorHistoryLength)));
      return;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      let content: string;
      let isError = false;
      try {
        content = await executeTool(toolUse.name, toolUse.input as Record<string, unknown>, deps);
      } catch (err) {
        // Un "invalid_grant" secco non dice niente all'utente, e il modello lo
        // parafrasava in un generico "non ci sono riuscito": la richiesta sembrava
        // fallita a caso, quando invece serviva una sola azione ben precisa.
        content = isAuthExpiredError(err)
          ? "L'autorizzazione Google e' scaduta e va rinnovata a mano: nessun accesso a Calendar o Gmail finche' non viene rifatta. Dillo all'utente in modo esplicito e non riprovare con altri strumenti Google."
          : `Errore nell'esecuzione dello strumento: ${err instanceof Error ? err.message : String(err)}`;
        isError = true;
      }
      toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content, is_error: isError });
    }

    messages = [...messages, { role: "user", content: toolResults }];
  }

  await ctx.send(jid, "Non sono riuscito a completare la richiesta (troppi passaggi), riprova con un messaggio più semplice.");
  histories.set(jid, trimHistory(compactOldToolResults(messages, priorHistoryLength)));
}
