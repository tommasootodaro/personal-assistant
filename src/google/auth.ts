import { google } from "googleapis";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

// Usiamo la classe OAuth2 esposta da "googleapis" (non un pacchetto
// "google-auth-library" separato) per evitare due copie della libreria
// con versioni diverse, che TypeScript tratterebbe come tipi incompatibili.
export type GoogleAuthClient = InstanceType<typeof google.auth.OAuth2>;

const REDIRECT_URI = "http://localhost:3000/oauth2callback";
// Un solo token per tutte le API Google usate (Calendar, Gmail), per non
// dover rifare il consenso una volta per servizio.
const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.readonly",
];
const TOKEN_PATH = path.resolve(process.cwd(), "token.json");

function createClient(): GoogleAuthClient {
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET mancanti nel file .env."
    );
  }
  return new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    REDIRECT_URI
  );
}

/**
 * Distingue "il consenso e' morto, serve che l'utente riautorizzi" da un errore
 * qualunque (rete assente, 500 di Google, quota). La distinzione conta perche'
 * le due situazioni vogliono reazioni opposte: sul primo caso bisogna buttare il
 * token e rifare il flusso di consenso, sul secondo bisogna tenerlo e riprovare.
 *
 * Il caso concreto che ha rotto il servizio dal 22/08/2026: il client OAuth e'
 * in stato "Testing" sulla Google Cloud Console, e Google fa scadere i refresh
 * token delle app in Testing dopo 7 giorni esatti.
 */
export function isAuthExpiredError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;

  const { response, message } = err as {
    response?: { data?: { error?: unknown } };
    message?: unknown;
  };

  // Guardiamo il codice OAuth nel corpo della risposta, non lo status HTTP: un
  // 400 arriva anche da una richiesta malformata o da parametri sbagliati, e
  // trattarlo come consenso scaduto vorrebbe dire buttare via un refresh token
  // ancora buono. GaxiosError riporta lo stesso codice anche in `message`, che
  // usiamo come ripiego.
  const fromBody = response?.data?.error;
  const code = typeof fromBody === "string" ? fromBody : typeof message === "string" ? message : "";

  // Solo "invalid_grant". Google lo usa per tutti i casi che si risolvono
  // rifacendo il consenso (token scaduto per i 7 giorni delle app in Testing,
  // consenso revocato a mano, password dell'account cambiata). Codici vicini
  // come "invalid_client" o "unauthorized_client" indicano invece credenziali
  // sbagliate nel .env: rifare il flusso OAuth non li aggiusterebbe, si
  // entrerebbe solo in un ciclo di riautorizzazioni che falliscono uguale.
  return code === "invalid_grant";
}

/**
 * Google restituisce un access token nuovo ogni ora, ma il codice non lo
 * salvava da nessuna parte: token.json restava fermo al primo rilascio e ad
 * ogni riavvio si ripartiva da un access token gia' scaduto, sperando nel
 * refresh. Persistiamo le credenziali aggiornate ad ogni refresh.
 */
function persistTokensOnRefresh(client: GoogleAuthClient): void {
  client.on("tokens", () => {
    // Salviamo client.credentials e non l'oggetto emesso dall'evento: ai
    // refresh successivi Google NON rimanda il refresh_token, mentre
    // client.credentials lo conserva. Scrivere l'evento grezzo lo cancellerebbe.
    writeFile(TOKEN_PATH, JSON.stringify(client.credentials, null, 2)).catch((err) =>
      console.error("Non sono riuscito a salvare il token Google aggiornato:", err)
    );
  });
}

async function loadSavedToken(client: GoogleAuthClient): Promise<boolean> {
  try {
    const raw = await readFile(TOKEN_PATH, "utf-8");
    client.setCredentials(JSON.parse(raw));
    return true;
  } catch {
    return false;
  }
}

async function runAuthFlow(client: GoogleAuthClient): Promise<void> {
  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  console.log("Apri questo link nel browser per autorizzare l'accesso a Calendar e Gmail:");
  console.log(authUrl);
  console.log("(il servizio resta fermo qui finche' non completi l'autorizzazione)");

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "", REDIRECT_URI);
      const authCode = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.end("Autorizzazione negata. Puoi chiudere questa finestra.");
        server.close();
        reject(new Error(`Autorizzazione Google negata: ${error}`));
        return;
      }
      if (!authCode) {
        res.end("Codice mancante. Puoi chiudere questa finestra.");
        return;
      }

      res.end("Autorizzazione completata. Puoi chiudere questa finestra e tornare al terminale.");
      server.close();
      resolve(authCode);
    });

    server.listen(3000);
  });

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  await writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log(`Token salvato in ${TOKEN_PATH}`);

  // Google lo rimanda solo per i client in "Testing", e non e' dichiarato nei
  // tipi di Credentials: e' proprio il campo che ci avrebbe fatto scoprire il
  // problema settimane prima, quindi lo leggiamo e lo segnaliamo.
  const refreshTtl = (tokens as { refresh_token_expires_in?: number }).refresh_token_expires_in;
  if (refreshTtl) {
    const days = Math.round(refreshTtl / 86400);
    console.warn(
      `ATTENZIONE: Google ha rilasciato un refresh token che scade tra ${days} giorni. ` +
        `Succede quando il client OAuth e' in stato "Testing": pubblica l'app ` +
        `("Publish app" nella schermata consenso OAuth della Google Cloud Console) ` +
        `per non dover rifare il login ogni settimana.`
    );
  }
}

/**
 * Porta il client ad avere credenziali valide: usa il token salvato se regge
 * ancora, altrimenti rifa' il consenso. Sta in una funzione separata perche' il
 * listener che persiste i refresh va agganciato solo DOPO questa fase.
 */
async function establishCredentials(client: GoogleAuthClient): Promise<void> {
  if (!(await loadSavedToken(client))) {
    await runAuthFlow(client);
    return;
  }

  // Un token su disco non e' detto sia ancora valido. Verifichiamolo subito,
  // all'avvio: senza questo controllo un consenso scaduto si manifestava solo
  // ore dopo, dentro un job schedulato o a meta' di una richiesta WhatsApp, e
  // il servizio restava su a fallire in silenzio a tempo indeterminato.
  try {
    await client.getAccessToken();
  } catch (err) {
    if (!isAuthExpiredError(err)) {
      // Rete giu' o Google momentaneamente indisponibile: il token e'
      // probabilmente ancora buono, ributtarlo sarebbe un autogol.
      console.error(
        "Verifica del token Google non riuscita, procedo comunque con quello salvato:",
        err instanceof Error ? err.message : err
      );
      return;
    }
    console.error("Il consenso Google non e' piu' valido: serve una nuova autorizzazione.");
    await runAuthFlow(client);
  }
}

export async function getAuthenticatedClient(): Promise<GoogleAuthClient> {
  const client = createClient();
  await establishCredentials(client);

  // Il listener si aggancia solo ORA, a credenziali gia' stabilite, e l'ordine
  // qui e' sostanziale. Durante lo scambio del codice getToken() emette
  // "tokens" PRIMA di aggiornare client.credentials: un listener gia' attivo
  // scriveva su disco le credenziali VECCHIE, e quella scrittura asincrona
  // correva con quella del token buono fatta da runAuthFlow arrivando dopo.
  // Il consenso riusciva, il servizio funzionava in memoria, ma token.json
  // restava morto e al riavvio successivo toccava riautorizzare da capo.
  persistTokensOnRefresh(client);
  return client;
}