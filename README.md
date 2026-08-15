# Personal Assistant

Assistente personale che gira in background sul PC, raggiungibile via WhatsApp.

## Cosa fa
- Risponde su WhatsApp usando Claude come orchestratore (tool use), con accesso a:
  - **Google Calendar**: legge, crea ed elimina eventi (anche "tutto il giorno", con colori)
  - **Gmail**: digest articolo-per-articolo delle newsletter TLDR ricevute nelle ultime 24 ore
  - **Vault Obsidian**: ricerca testuale nelle note; salvataggio rapido di idee come note singole categorizzate (`Idee/<categoria>/`, con indice a link in `Idee/Inbox.md`)
- Ogni giorno, di sua iniziativa, manda un digest con impegni calendario + TLDR (orario configurabile, vedi `.env`)
- Risponde solo nella chat "con se stessi": ignora messaggi da gruppi o altri contatti
- Gira in background all'avvio del PC (Task Scheduler di Windows), si riconnette da solo con backoff in caso di caduta della connessione, logga su file (`logs/app.log`)

## Stack
- Node.js + TypeScript (ESM)
- [Baileys](https://github.com/WhiskeySockets/Baileys) per WhatsApp
- Google APIs Node.js client per Calendar + Gmail
- Claude (Anthropic API) come motore di orchestrazione/risposta

## Setup locale
```bash
npm install
cp .env.example .env   # poi riempire .env con le proprie credenziali
npm run dev
```
Al primo avvio: scansiona il QR mostrato in terminale (o apri `whatsapp-qr.png`, salvato nella root) per collegare WhatsApp; segui il link stampato in terminale per completare l'OAuth con Google (Calendar + Gmail, un consenso unico).

## Script utili
- `npm run dev` — avvio in sviluppo, con ricarica automatica ai cambi di file
- `npm run build` / `npm start` — build di produzione + avvio
- `npm run calendar:test` — verifica lettura eventi calendario da terminale
- `npm run vault:test -- "query"` — verifica ricerca testuale nel vault
- `npm run email:test` — verifica digest email da terminale
- `npm run digest:test` — verifica composizione del digest mattutino (calendario + TLDR), senza inviarlo su WhatsApp

## Struttura
```
src/
  assistant/    # orchestratore Claude (tool use) e digest mattutino
  calendar/     # Google Calendar: lettura/creazione/eliminazione eventi, colori
  email/        # Gmail: lettura, regole (Email Rules.md), classificazione, riassunto
  google/       # autenticazione OAuth condivisa (Calendar + Gmail)
  vault/        # ricerca nelle note, salvataggio idee
  whatsapp/     # connessione Baileys, filtro "solo chat con se stessi"
  logger.ts     # specchia console.* su file, con rotazione
  scheduler.ts  # job schedulato giornaliero (digest mattutino)
Personal Assistant/   # vault Obsidian (knowledge base + log di progetto)
.env            # credenziali locali (NON versionato)
```

## Affidabilità
Il servizio gira come attività pianificata di Windows: avvio automatico al boot, riavvio automatico in caso di crash, nessuna doppia istanza. Dettagli di configurazione dell'attività pianificata in `Personal Assistant/Assistant Log/Changelog.md` (Fase 6).

## Stato del progetto
Per la roadmap e lo storico completo delle decisioni tecniche, vedi il vault Obsidian:
`Personal Assistant/Assistant Log/Roadmap.md` e `Changelog.md`.
