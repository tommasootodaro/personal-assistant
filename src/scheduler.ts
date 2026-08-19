import fs from "node:fs";
import path from "node:path";

const TIME_ZONE = "Europe/Rome";
// Stato minimo per il recupero same-day: per ogni job, l'ultima data (YYYY-MM-DD,
// fuso Europe/Rome) in cui e' effettivamente scattato. Persistito su file perche'
// il processo puo' riavviarsi piu' volte nello stesso giorno (crash, riavvio del
// PC) e senza questa memoria un job gia' recuperato scatterebbe di nuovo ad ogni
// riavvio invece che una sola volta al giorno.
const STATE_PATH = path.resolve(process.cwd(), "logs", "schedule-state.json");

function getLocalTimeParts(): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());
}

function readState(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function alreadyRanToday(jobId: string): boolean {
  return readState()[jobId] === todayKey();
}

function markRanToday(jobId: string): void {
  const state = readState();
  state[jobId] = todayKey();
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.error(`Impossibile salvare lo stato dello scheduler per "${jobId}":`, err);
  }
}

/**
 * Prossima Date assoluta (UTC) in cui l'orologio del fuso TIME_ZONE segna hour:minute.
 * Tratta i componenti locali come se fossero UTC per calcolarne la differenza rispetto
 * ad "ora": l'offset del fuso si semplifica nella sottrazione, quindi il risultato resta
 * corretto anche a cavallo dell'ora legale, senza bisogno di una libreria di date/fusi.
 */
function nextOccurrence(hour: number, minute: number): Date {
  const p = getLocalTimeParts();
  const nowAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  let targetAsUtc = Date.UTC(p.year, p.month - 1, p.day, hour, minute, 0);
  if (targetAsUtc <= nowAsUtc) targetAsUtc += 24 * 60 * 60 * 1000;

  return new Date(Date.now() + (targetAsUtc - nowAsUtc));
}

function todaysOccurrenceAlreadyPassed(hour: number, minute: number): boolean {
  const p = getLocalTimeParts();
  const nowAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const targetAsUtc = Date.UTC(p.year, p.month - 1, p.day, hour, minute, 0);
  return targetAsUtc <= nowAsUtc;
}

const RETRY_ATTEMPTS = 6;
const RETRY_DELAY_MS = 20000;

/**
 * Esegue `task` con qualche ritentativo in caso di errore, prima di arrendersi
 * per la giornata. Pensato per errori di rete transitori (es. la connessione
 * non ancora stabile subito dopo un risveglio dallo standby, vedi changelog
 * 2026-08-17): senza retry, un singolo `ECONNRESET` durante il recupero
 * same-day marcava il job come "tentato" per il resto della giornata pur non
 * avendo mai realmente inviato nulla.
 * Finestra allargata a ~2 minuti (20s tra un tentativo e l'altro, invece di
 * 3s): il primo giro (9s totali) non ha retto un blip di rete più lungo, es.
 * al risveglio dallo standby con la connessione già caduta più volte prima
 * (vedi changelog 2026-08-19).
 */
async function runWithRetries(task: () => void | Promise<void>, jobId: string): Promise<void> {
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      await task();
      return;
    } catch (err) {
      if (attempt === RETRY_ATTEMPTS) {
        console.error(`Errore nel job schedulato ("${jobId}") dopo ${RETRY_ATTEMPTS} tentativi, rimandato a domani:`, err);
        return;
      }
      console.error(`Errore nel job schedulato ("${jobId}"), tentativo ${attempt}/${RETRY_ATTEMPTS}, ritento tra ${RETRY_DELAY_MS / 1000}s:`, err);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

/**
 * Esegue `task` ogni giorno a hour:minute (fuso Europe/Rome). Ricalcola la prossima
 * occorrenza dopo ogni esecuzione (invece di un interval fisso a 24h), cosi' non
 * accumula drift e resta corretto attraverso i cambi di ora legale.
 *
 * Recupero same-day: se il processo parte (o riparte) lo stesso giorno ma dopo
 * hour:minute e il job non e' ancora scattato oggi (es. il servizio era spento
 * alle 7:30), lo esegue subito invece di aspettare l'occorrenza di domani — meglio
 * un promemoria in ritardo che nessuno. `jobId` identifica il job nello stato
 * persistito, per non recuperarlo più volte in caso di riavvii ravvicinati.
 */
export function scheduleDaily(hour: number, minute: number, task: () => void | Promise<void>, jobId: string): void {
  const runAndReschedule = async () => {
    await runWithRetries(task, jobId);
    markRanToday(jobId);
    scheduleDaily(hour, minute, task, jobId);
  };

  if (todaysOccurrenceAlreadyPassed(hour, minute) && !alreadyRanToday(jobId)) {
    const hh = String(hour).padStart(2, "0");
    const mm = String(minute).padStart(2, "0");
    console.log(`Recupero l'occorrenza odierna del job "${jobId}" (il servizio non era attivo alle ${hh}:${mm}).`);
    void runAndReschedule();
    return;
  }

  const delay = nextOccurrence(hour, minute).getTime() - Date.now();
  setTimeout(() => void runAndReschedule(), delay);
}
