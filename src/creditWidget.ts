import fs from "node:fs";
import { config } from "./config.js";

/**
 * Segnala al widget dei crediti Anthropic (in esecuzione sul desktop, sessione
 * interattiva dell'utente) di aggiornarsi. Questo processo gira invece come
 * attivita' pianificata di Windows in Session 0 (nessun desktop interattivo,
 * vedi README/Fase 6): non puo' manipolare direttamente le finestre del
 * widget, quindi si limita a scrivere questo file — overlay-widget.ps1 lo
 * osserva e lancia da solo, dalla sessione giusta, il refresh vero e proprio.
 * Il widget e' un extra opzionale: un fallimento qui non deve mai interrompere
 * la risposta all'utente su WhatsApp.
 */
export function requestCreditWidgetRefresh(): void {
  try {
    fs.writeFileSync(config.creditWidgetTriggerPath, new Date().toISOString(), "utf-8");
  } catch (err) {
    console.error("Impossibile segnalare il refresh del widget crediti:", err);
  }
}
