import { getAuthenticatedClient } from "./auth.js";
import { listUpcomingEvents } from "./events.js";

async function main() {
  const auth = await getAuthenticatedClient();
  const events = await listUpcomingEvents(auth, 7);

  console.log(`Eventi nei prossimi 7 giorni (${events.length}):`);
  for (const event of events) {
    const suffix = event.allDay ? " (tutto il giorno)" : "";
    console.log(`- ${event.title} | ${event.start} -> ${event.end}${suffix}`);
  }
}

main().catch((err) => {
  console.error("Errore:", err);
  process.exit(1);
});
