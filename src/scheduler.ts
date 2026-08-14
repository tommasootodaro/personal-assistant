const TIME_ZONE = "Europe/Rome";

/**
 * Prossima Date assoluta (UTC) in cui l'orologio del fuso TIME_ZONE segna hour:minute.
 * Tratta i componenti locali come se fossero UTC per calcolarne la differenza rispetto
 * ad "ora": l'offset del fuso si semplifica nella sottrazione, quindi il risultato resta
 * corretto anche a cavallo dell'ora legale, senza bisogno di una libreria di date/fusi.
 */
function nextOccurrence(hour: number, minute: number): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);

  const nowAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  let targetAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, minute, 0);
  if (targetAsUtc <= nowAsUtc) targetAsUtc += 24 * 60 * 60 * 1000;

  return new Date(now.getTime() + (targetAsUtc - nowAsUtc));
}

/**
 * Esegue `task` ogni giorno a hour:minute (fuso Europe/Rome). Ricalcola la prossima
 * occorrenza dopo ogni esecuzione (invece di un interval fisso a 24h), cosi' non
 * accumula drift e resta corretto attraverso i cambi di ora legale.
 */
export function scheduleDaily(hour: number, minute: number, task: () => void | Promise<void>): void {
  const delay = nextOccurrence(hour, minute).getTime() - Date.now();
  setTimeout(() => {
    void (async () => {
      try {
        await task();
      } catch (err) {
        console.error("Errore nel job schedulato:", err);
      }
      scheduleDaily(hour, minute, task);
    })();
  }, delay);
}
