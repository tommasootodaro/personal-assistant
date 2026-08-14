import { connectWhatsApp, getSelfJid } from "./whatsapp/connection.js";
import { getAuthenticatedClient } from "./google/auth.js";
import { handleMessage } from "./assistant/orchestrator.js";

// Baileys a volte rigetta una promise internamente (es. invio fallito durante
// un hiccup di connessione) senza che il nostro codice possa intercettarla
// con un try/catch: senza questo handler, Node terminerebbe l'intero processo
// per un problema transitorio da cui la libreria si riprenderebbe da sola.
process.on("unhandledRejection", (err) => {
  console.error("Promise non gestita (probabile hiccup di connessione):", err);
});

async function main() {
  console.log("Personal Assistant: autenticazione Google (Calendar + Gmail)...");
  const googleAuth = await getAuthenticatedClient();
  console.log("Google autenticato.");

  console.log("Personal Assistant: avvio connessione WhatsApp...");

  await connectWhatsApp(
    (ctx) => {
      // Solo log in terminale: niente messaggio su WhatsApp ad ogni (ri)connessione.
      console.log(`Assistente pronto (${getSelfJid(ctx.sock)}).`);
    },
    async (ctx, remoteJid, text) => {
      try {
        await handleMessage(ctx, remoteJid, text, { googleAuth });
      } catch (err) {
        console.error("Errore nella gestione del messaggio:", err);
        await ctx.send(remoteJid, "Si e' verificato un errore, riprova.");
      }
    }
  );
}

main().catch((err) => {
  console.error("Errore durante l'avvio:", err);
  process.exit(1);
});
