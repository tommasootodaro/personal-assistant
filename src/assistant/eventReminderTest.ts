import { getAuthenticatedClient } from "../google/auth.js";
import { buildEventReminder } from "./eventReminder.js";

async function main() {
  const googleAuth = await getAuthenticatedClient();
  const text = await buildEventReminder({ googleAuth });
  console.log(text ?? "(nessun impegno rilevante: oggi vuoto, niente di presto domani mattina)");
}

main().catch((err) => {
  console.error("Errore:", err);
  process.exit(1);
});
