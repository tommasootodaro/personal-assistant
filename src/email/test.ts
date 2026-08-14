import { getAuthenticatedClient } from "../google/auth.js";
import { fetchRecentEmails } from "./gmail.js";
import { loadEmailRules } from "./rules.js";
import { classifyEmail, type Priority } from "./classify.js";
import { summarizeEmails, type SummarizedEmail } from "./summarize.js";

const HOURS = 24;

const GROUP_ORDER: Priority[] = ["alta", "normale", "bassa"];
const GROUP_LABELS: Record<Priority, string> = {
  alta: "Priorità alta",
  normale: "Normale",
  bassa: "Priorità bassa / newsletter",
};

async function main() {
  const auth = await getAuthenticatedClient();
  const rules = await loadEmailRules();

  console.log(`Recupero mail delle ultime ${HOURS} ore...`);
  const emails = await fetchRecentEmails(auth, HOURS);
  console.log(`Trovate ${emails.length} mail.\n`);

  if (emails.length === 0) return;

  const classified = emails.map((e) => classifyEmail(e, rules));
  const summarized = await summarizeEmails(classified);

  const groups: Record<Priority, SummarizedEmail[]> = { alta: [], normale: [], bassa: [] };
  for (const e of summarized) groups[e.priority].push(e);

  for (const key of GROUP_ORDER) {
    const items = groups[key];
    if (items.length === 0) continue;

    console.log(`=== ${GROUP_LABELS[key]} (${items.length}) ===`);
    for (const e of items) {
      const tag = e.isNewsletter ? " [newsletter]" : "";
      console.log(`- ${e.senderName || e.senderEmail}${tag} — ${e.subject}`);
      console.log(`  ${e.summary}`);
    }
    console.log();
  }
}

main().catch((err) => {
  console.error("Errore:", err);
  process.exit(1);
});
