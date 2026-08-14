import type { FetchedEmail } from "./gmail.js";
import { matchesRule, type EmailRules } from "./rules.js";

export type Priority = "alta" | "normale" | "bassa";

export interface ClassifiedEmail extends FetchedEmail {
  priority: Priority;
  isNewsletter: boolean;
}

export function classifyEmail(email: FetchedEmail, rules: EmailRules): ClassifiedEmail {
  let isNewsletter = email.hasListUnsubscribe;
  if (matchesRule(email.senderEmail, rules.forcedNewsletter)) isNewsletter = true;
  if (matchesRule(email.senderEmail, rules.excludedNewsletter)) isNewsletter = false;

  let priority: Priority = "normale";
  if (matchesRule(email.senderEmail, rules.highPriority)) {
    priority = "alta";
  } else if (matchesRule(email.senderEmail, rules.lowPriority) || isNewsletter) {
    priority = "bassa";
  }

  return { ...email, priority, isNewsletter };
}
