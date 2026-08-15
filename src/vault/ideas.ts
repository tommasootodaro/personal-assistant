import fs from "node:fs/promises";
import path from "node:path";

export const IDEA_CATEGORIES = [
  "AI",
  "Finanza",
  "Energia",
  "Tempo libero",
  "Lavoro",
  "Salute",
  "Casa",
  "Viaggi",
  "Altro",
] as const;

export type IdeaCategory = (typeof IDEA_CATEGORIES)[number];

const IDEAS_DIR = "Idee";
const INBOX_RELATIVE_PATH = path.join(IDEAS_DIR, "Inbox.md");
const INBOX_HEADER =
  "# Inbox idee\n\nIndice di tutte le idee annotate dal telefono. Il testo di ciascuna vive nella sua nota singola (linkata qui sotto), organizzata per categoria in sottocartelle.\n\n";

export interface NewIdea {
  title: string;
  category: IdeaCategory;
  text: string;
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "").trim();
  return cleaned.slice(0, 80) || "Idea";
}

function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
}

async function uniqueFilePath(dir: string, baseName: string): Promise<string> {
  let candidate = path.join(dir, `${baseName}.md`);
  for (let suffix = 2; ; suffix++) {
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
    candidate = path.join(dir, `${baseName} (${suffix}).md`);
  }
}

/**
 * Crea una nota singola per l'idea in "Idee/<categoria>/" (frontmatter con
 * categoria/data + testo), e ne accoda il link nell'indice "Idee/Inbox.md".
 * Le note singole permettono di taggare/spostare/organizzare ogni idea
 * individualmente in Obsidian man mano che se ne accumulano.
 */
export async function saveIdea(vaultPath: string, idea: NewIdea): Promise<string> {
  const categoryDir = path.join(vaultPath, IDEAS_DIR, idea.category);
  await fs.mkdir(categoryDir, { recursive: true });

  const baseName = `${todayIso()} ${sanitizeFileName(idea.title)}`;
  const notePath = await uniqueFilePath(categoryDir, baseName);
  const noteName = path.basename(notePath, ".md");

  const timestamp = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());

  const noteContent = `---\ncategoria: ${idea.category}\ndata: ${timestamp}\n---\n\n# ${idea.title}\n\n${idea.text.trim()}\n`;
  await fs.writeFile(notePath, noteContent, "utf-8");

  const inboxPath = path.join(vaultPath, INBOX_RELATIVE_PATH);
  let inboxExisting: string;
  try {
    inboxExisting = await fs.readFile(inboxPath, "utf-8");
  } catch {
    inboxExisting = INBOX_HEADER;
  }
  const inboxBase = inboxExisting.endsWith("\n") ? inboxExisting : inboxExisting + "\n";
  const relativeLink = `${IDEAS_DIR}/${idea.category}/${noteName}`;
  await fs.writeFile(inboxPath, `${inboxBase}- [${idea.category}] [[${relativeLink}]]\n`, "utf-8");

  return notePath;
}
