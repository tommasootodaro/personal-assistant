import type { GoogleAuthClient } from "../google/auth.js";
import { fetchRecentEmails } from "./gmail.js";
import { loadEmailRules, matchesRule } from "./rules.js";
import { classifyEmail } from "./classify.js";
import { summarizeDetailed } from "./summarize.js";

/** Digest testuale (articolo per articolo) delle newsletter TLDR ricevute nelle ultime 24 ore. */
export async function getTldrDigestText(auth: GoogleAuthClient): Promise<string> {
  const rules = await loadEmailRules();
  const emails = await fetchRecentEmails(auth, 24);
  const classified = emails.map((e) => classifyEmail(e, rules));
  const detailed = classified.filter((e) => matchesRule(e.senderEmail, rules.detailedDigest));
  if (detailed.length === 0) return "Nessuna newsletter TLDR ricevuta nelle ultime 24 ore.";
  const digests = await summarizeDetailed(detailed);
  return digests.map((d) => `### ${d.subject}\n${d.items.map((i) => `- ${i}`).join("\n")}`).join("\n\n");
}
