# Personal Assistant

Assistente personale che gira in background sul PC, raggiungibile via WhatsApp, con accesso a:
- **Google Calendar** (lettura impegni, promemoria)
- **Vault Obsidian** (knowledge base personale, in `./Personal Assistant/`)
- **Claude (Anthropic API)** come motore di orchestrazione/risposta

Per la roadmap del progetto e lo storico delle decisioni, vedi il vault Obsidian:
`Personal Assistant/Assistant Log/Roadmap.md` e `Changelog.md`.

## Stack
- Node.js + TypeScript (ESM)
- [Baileys](https://github.com/WhiskeySockets/Baileys) per WhatsApp
- Google APIs Node.js client per Calendar

## Setup locale
```bash
npm install
cp .env.example .env   # poi riempire .env con le proprie credenziali
npm run dev
```

## Struttura
```
src/            # codice sorgente
Personal Assistant/   # vault Obsidian (knowledge base + log di progetto)
.env            # credenziali locali (NON versionato)
```

## Stato del progetto
Vedi `Personal Assistant/Assistant Log/Changelog.md` per lo storico aggiornato.
