import { transcribePcm } from "./transcribe.js";

// Smoke test: verifica che il modello si scarichi/carichi e che la pipeline
// giri senza errori su questa macchina (Windows ARM64), senza dover fabbricare
// un vero file Ogg/Opus. Un secondo di silenzio non prova l'accuratezza della
// trascrizione (per quella serve un vocale vero, verificato via WhatsApp) ma
// prova che tutta la catena (download modello, ONNX Runtime, pipeline) regge.
async function main(): Promise<void> {
  const oneSecondOfSilence = new Float32Array(16_000);
  console.log("Avvio smoke test trascrizione (silenzio di 1s)...");
  const text = await transcribePcm(oneSecondOfSilence);
  console.log(`Trascrizione risultante: "${text}"`);
  console.log("Smoke test completato senza errori.");
}

main().catch((err) => {
  console.error("Smoke test fallito:", err);
  process.exit(1);
});
