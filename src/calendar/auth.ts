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
const SCOPES = ["https://www.googleapis.com/auth/calendar"];
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

  console.log("Apri questo link nel browser per autorizzare l'accesso al calendario:");
  console.log(authUrl);

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
}

export async function getAuthenticatedClient(): Promise<GoogleAuthClient> {
  const client = createClient();

  const hasToken = await loadSavedToken(client);
  if (!hasToken) {
    await runAuthFlow(client);
  }

  return client;
}
