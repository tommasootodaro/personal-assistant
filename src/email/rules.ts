import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export interface EmailRules {
  highPriority: string[];
  lowPriority: string[];
  forcedNewsletter: string[];
  excludedNewsletter: string[];
}

const RULES_FILE_NAME = "Email Rules.md";
const RULES_RELATIVE_PATH = path.join("Assistant Log", RULES_FILE_NAME);

const SECTION_HEADINGS: Record<keyof EmailRules, string> = {
  highPriority: "priorità alta",
  lowPriority: "priorità bassa",
  forcedNewsletter: "newsletter forzate",
  excludedNewsletter: "newsletter escluse",
};

function extractListItems(content: string, heading: string): string[] {
  const lines = content.split("\n");
  const headingIndex = lines.findIndex(
    (line) => line.trim().toLowerCase().replace(/^#+\s*/, "") === heading
  );
  if (headingIndex === -1) return [];

  const items: string[] = [];
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("#")) break; // prossima sezione
    const match = line.match(/^-\s+(.+)$/);
    if (match) {
      const value = match[1].trim().toLowerCase();
      // Ignora la riga placeholder di esempio, es. "(aggiungi qui...)" o "(es. ...)"
      if (!value.startsWith("(")) items.push(value);
    }
  }
  return items;
}

export async function loadEmailRules(): Promise<EmailRules> {
  const filePath = path.join(config.obsidianVaultPath, RULES_RELATIVE_PATH);

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return { highPriority: [], lowPriority: [], forcedNewsletter: [], excludedNewsletter: [] };
  }

  return {
    highPriority: extractListItems(content, SECTION_HEADINGS.highPriority),
    lowPriority: extractListItems(content, SECTION_HEADINGS.lowPriority),
    forcedNewsletter: extractListItems(content, SECTION_HEADINGS.forcedNewsletter),
    excludedNewsletter: extractListItems(content, SECTION_HEADINGS.excludedNewsletter),
  };
}

/** true se l'indirizzo compare esplicitamente in lista, o il suo dominio compare come "@dominio". */
export function matchesRule(senderEmail: string, rule: string[]): boolean {
  const email = senderEmail.toLowerCase();
  const domain = email.split("@")[1] ?? "";
  return rule.some((entry) => entry === email || entry === `@${domain}`);
}
