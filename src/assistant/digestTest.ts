import { getAuthenticatedClient } from "../google/auth.js";
import { buildMorningDigest } from "./morningDigest.js";

async function main() {
  const googleAuth = await getAuthenticatedClient();
  const text = await buildMorningDigest({ googleAuth });
  console.log(text);
}

main().catch((err) => {
  console.error("Errore:", err);
  process.exit(1);
});
