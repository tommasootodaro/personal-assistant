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
  "Trasporti",
  "Altro",
] as const;

export type IdeaCategory = (typeof IDEA_CATEGORIES)[number];

export const IDEA_TYPES = ["startup", "spunto"] as const;

export type IdeaType = (typeof IDEA_TYPES)[number];

const IDEAS_DIR = "Idee";
const INBOX_RELATIVE_PATH = path.join(IDEAS_DIR, "Inbox.md");
const INBOX_HEADER = "# Inbox idee\n\nIndice delle categorie. Ogni categoria elenca le proprie idee nella sua nota.\n\n";

export interface NewIdea {
  title: string;
  category: IdeaCategory;
  type: IdeaType;
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

/** Accoda `line` a `filePath` solo se non e' gia' presente (idempotente), creando il file con `header` se manca. */
async function appendLineIfMissing(filePath: string, header: string, line: string): Promise<void> {
  let existing: string;
  try {
    existing = await fs.readFile(filePath, "utf-8");
  } catch {
    existing = header;
  }
  if (existing.includes(line)) return;
  const base = existing.endsWith("\n") ? existing : existing + "\n";
  await fs.writeFile(filePath, `${base}${line}\n`, "utf-8");
}

/**
 * Crea una nota singola per l'idea in "Idee/<categoria>/" (frontmatter con
 * categoria/tipo/data + testo; il tag "tipo" pilota anche il colore in Graph
 * View, vedi .obsidian/graph.json), la collega dalla nota di categoria
 * "Idee/<categoria>.md" (creata se manca), e assicura che quest'ultima sia
 * linkata dall'indice "Idee/Inbox.md". Struttura a tre livelli (Inbox ->
 * categoria -> idea) invece di un indice piatto, per una graph view leggibile
 * anche con molte idee.
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

  const noteContent = `---\ncategoria: ${idea.category}\ntipo: ${idea.type}\ntags: [idea, ${idea.type}]\ndata: ${timestamp}\n---\n\n# ${idea.title}\n\n${idea.text.trim()}\n`;
  await fs.writeFile(notePath, noteContent, "utf-8");

  const categoryNotePath = path.join(vaultPath, IDEAS_DIR, `${idea.category}.md`);
  const ideaLink = `${IDEAS_DIR}/${idea.category}/${noteName}`;
  await appendLineIfMissing(categoryNotePath, `# ${idea.category}\n\n`, `- [[${ideaLink}]]`);

  const inboxPath = path.join(vaultPath, INBOX_RELATIVE_PATH);
  const categoryLink = `${IDEAS_DIR}/${idea.category}`;
  await appendLineIfMissing(inboxPath, INBOX_HEADER, `- [[${categoryLink}]]`);

  return notePath;
}
