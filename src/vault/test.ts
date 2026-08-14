import { config } from "../config.js";
import { loadNotes, searchNotes } from "./search.js";

async function main() {
  const query = process.argv.slice(2).join(" ").trim();

  if (!query) {
    console.error('Uso: npm run vault:test -- "cosa ho scritto su X"');
    process.exit(1);
  }

  if (!config.obsidianVaultPath) {
    console.error("OBSIDIAN_VAULT_PATH non configurato in .env");
    process.exit(1);
  }

  console.log(`Vault: ${config.obsidianVaultPath}`);
  console.log(`Query: "${query}"\n`);

  const notes = await loadNotes(config.obsidianVaultPath);
  console.log(`Note indicizzate: ${notes.length}\n`);

  const results = searchNotes(query, notes);

  if (results.length === 0) {
    console.log("Nessuna nota pertinente trovata.");
    return;
  }

  for (const [i, result] of results.entries()) {
    console.log(`--- Risultato ${i + 1} (score ${result.score}) ---`);
    console.log(`Titolo: ${result.note.title}`);
    console.log(`File: ${result.note.filePath}`);
    console.log(`Estratto:\n${result.excerpt}\n`);
  }
}

main().catch((err) => {
  console.error("Errore:", err);
  process.exit(1);
});
