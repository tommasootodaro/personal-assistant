# Informativa sulla privacy

**Ultimo aggiornamento: 10 settembre 2026**

Questo documento descrive come "Personal Assistant" tratta i dati. Il progetto è
un assistente personale a uso privato: gira in locale sul PC del suo autore, che
ne è anche l'unico utente. Non è un servizio offerto a terzi, non ha registrazione
utenti e non ha un backend remoto.

Per qualsiasi domanda si puo' aprire una issue nel repository:
https://github.com/tommasootodaro/personal-assistant/issues

## Dati a cui l'applicazione accede

L'accesso avviene tramite OAuth 2.0 di Google, con il consenso esplicito
dell'utente, e si limita a questi ambiti:

| Ambito | Scopo OAuth | Uso concreto |
|---|---|---|
| Google Calendar | `.../auth/calendar` | Leggere gli impegni per il promemoria giornaliero; creare, modificare ed eliminare eventi su richiesta dell'utente |
| Gmail | `.../auth/gmail.readonly` | Sola lettura. Vengono lette esclusivamente le newsletter TLDR ricevute nelle ultime 24 ore, per riassumerle |

L'accesso a Gmail è in **sola lettura**: l'applicazione non invia, non modifica e
non elimina messaggi di posta.

Oltre a questi, l'applicazione tratta i messaggi WhatsApp scambiati dall'utente
con se stesso (la chat "con se stessi"; messaggi di gruppi o di altri contatti
vengono ignorati) e le note di una cartella Obsidian locale.

## Dove vengono conservati i dati

Tutto resta sul computer dell'utente. Nello specifico:

- il token OAuth di Google è salvato in un file locale (`token.json`);
- la sessione WhatsApp è salvata in una cartella locale (`auth/`);
- le note Obsidian sono file locali;
- i log applicativi sono file locali (`logs/`).

Non esiste alcun database remoto, nessun server applicativo e nessun backup su
cloud gestito dal progetto. Nessun dato viene venduto, ceduto o condiviso a fini
pubblicitari, e non è presente alcuna forma di analytics o tracciamento.

## Terze parti coinvolte

- **Anthropic (API Claude)**: il testo dei messaggi e i dati necessari a
  soddisfare la richiesta (per esempio titoli e orari degli eventi, o il testo
  delle newsletter da riassumere) vengono inviati all'API di Claude, che genera
  la risposta. Si applica l'informativa di Anthropic.
- **Google**: fornisce le API Calendar e Gmail sopra descritte.
- **WhatsApp / Meta**: è il canale su cui transitano i messaggi.

I messaggi vocali fanno eccezione: la trascrizione avviene **interamente in
locale** con un modello Whisper eseguito sulla macchina dell'utente. L'audio non
viene caricato su alcun servizio esterno.

## Conservazione e cancellazione

I dati restano finché l'utente non li rimuove. Per revocare l'accesso:

- revocare il permesso da [myaccount.google.com/permissions](https://myaccount.google.com/permissions);
- eliminare `token.json` per rimuovere le credenziali Google salvate in locale;
- eliminare la cartella `auth/` per scollegare la sessione WhatsApp;
- eliminare la cartella `logs/` per rimuovere i log.

## Modifiche

Eventuali modifiche a questa informativa saranno pubblicate su questa stessa
pagina, con la data di aggiornamento in cima.
