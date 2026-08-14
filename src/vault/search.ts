import fs from "node:fs/promises";
import path from "node:path";

export interface Note {
  title: string;
  filePath: string;
  content: string;
}

export interface SearchResult {
  note: Note;
  score: number;
  excerpt: string;
}

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // salta .obsidian e simili

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

function extractTitle(fileName: string, content: string): string {
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();
  return path.basename(fileName, ".md");
}

export async function loadNotes(vaultPath: string): Promise<Note[]> {
  const files = await collectMarkdownFiles(vaultPath);

  return Promise.all(
    files.map(async (filePath) => {
      const content = await fs.readFile(filePath, "utf-8");
      return {
        title: extractTitle(filePath, content),
        filePath,
        content,
      };
    })
  );
}

function buildExcerpt(content: string, queryWords: string[], radius = 250): string {
  const lowerContent = content.toLowerCase();
  let matchIndex = -1;

  for (const word of queryWords) {
    const idx = lowerContent.indexOf(word);
    if (idx !== -1 && (matchIndex === -1 || idx < matchIndex)) {
      matchIndex = idx;
    }
  }

  if (matchIndex === -1) {
    return content.slice(0, radius * 2).trim();
  }

  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(content.length, matchIndex + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";

  return `${prefix}${content.slice(start, end).trim()}${suffix}`;
}

export function searchNotes(query: string, notes: Note[], limit = 5): SearchResult[] {
  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);

  if (queryWords.length === 0) return [];

  const results: SearchResult[] = [];

  for (const note of notes) {
    const lowerTitle = note.title.toLowerCase();
    const lowerContent = note.content.toLowerCase();
    let score = 0;

    for (const word of queryWords) {
      const titleMatches = lowerTitle.split(word).length - 1;
      const contentMatches = lowerContent.split(word).length - 1;
      score += titleMatches * 5 + contentMatches;
    }

    if (lowerContent.includes(query.toLowerCase())) {
      score += 10;
    }

    if (score > 0) {
      results.push({
        note,
        score,
        excerpt: buildExcerpt(note.content, queryWords),
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
