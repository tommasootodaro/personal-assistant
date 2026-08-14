import { getAuthenticatedClient } from "../google/auth.js";
import { fetchRecentEmails } from "./gmail.js";
import { loadEmailRules, matchesRule } from "./rules.js";
import { classifyEmail } from "./classify.js";
import { summarizeDetailed } from "./summarize.js";

const HOURS = 24;

async function main() {
  const auth = await getAuthenticatedClient();
  const rules = await loadEmailRules();

  console.log(`Recupero mail delle ultime ${HOURS} ore...`);
  const emails = await fetchRecentEmails(auth, HOURS);
  console.log(`Trovate ${emails.length} mail.\n`);

  if (emails.length === 0) return;

  const classified = emails.map((e) => classifyEmail(e, rules));

  // Solo i mittenti in "Digest dettagliato" vengono mandati a Claude: le altre
  // mail restano fuori dal costo del riassunto, elencate soltanto per visibilità.
  const detailed = classified.filter((e) => matchesRule(e.senderEmail, rules.detailedDigest));
  const skipped = classified.filter((e) => !matchesRule(e.senderEmail, rules.detailedDigest));

  if (detailed.length > 0) {
    const digests = await summarizeDetailed(detailed);
    console.log(`=== Digest dettagliato (${digests.length}) ===`);
    for (const d of digests) {
      console.log(`\n${d.senderName || d.senderEmail} — ${d.subject}`);
      for (const item of d.items) {
        console.log(`  - ${item}`);
      }
    }
    console.log();
  } else {
    console.log("Nessuna mail corrisponde alle regole di 'Digest dettagliato' (vedi Email Rules.md).\n");
  }

  if (skipped.length > 0) {
    console.log(`=== Non elaborate, solo elenco (${skipped.length}) — nessuna chiamata a Claude ===`);
    for (const e of skipped) {
      console.log(`- ${e.senderName || e.senderEmail} — ${e.subject}`);
    }
  }
}

main().catch((err) => {
  console.error("Errore:", err);
  process.exit(1);
});
