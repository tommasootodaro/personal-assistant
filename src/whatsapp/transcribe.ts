import { pipeline, env } from "@huggingface/transformers";
import type { AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { OggOpusDecoder } from "ogg-opus-decoder";
import path from "node:path";

// Modello scaricato una tantum (~500MB) e messo in cache qui, invece che nella
// cartella di default della libreria: cosi' resta ovviamente escluso da Git
// (vedi .gitignore) ed e' facile da individuare/ripulire.
env.cacheDir = path.resolve(process.cwd(), "models");

const WHISPER_MODEL = "Xenova/whisper-small";

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriberPromise) {
    console.log(
      `Carico il modello di trascrizione (${WHISPER_MODEL})... al primo avvio puo' richiedere qualche minuto (download del modello).`
    );
    transcriberPromise = pipeline("automatic-speech-recognition", WHISPER_MODEL).then((t) => {
      console.log("Modello di trascrizione pronto.");
      return t as AutomaticSpeechRecognitionPipeline;
    });
  }
  return transcriberPromise;
}

/**
 * Decodifica un vocale WhatsApp (Ogg/Opus) direttamente in PCM mono a 16kHz,
 * il formato richiesto in ingresso da Whisper - evita cosi' di dover passare
 * da un binario esterno tipo ffmpeg (che tra l'altro non ha una build
 * precompilata per Windows ARM64, l'architettura di questo PC).
 */
async function decodeVoiceNoteToPcm16k(oggBuffer: Buffer): Promise<Float32Array> {
  // `sampleRate` e' supportato a runtime (vedi OggOpusDecoder.js) ma manca dalle
  // definizioni .d.ts spedite nel pacchetto (disallineate rispetto al codice
  // reale) - da qui il cast.
  const decoder = new OggOpusDecoder({ sampleRate: 16000 } as ConstructorParameters<typeof OggOpusDecoder>[0]);
  await decoder.ready;
  const { channelData } = await decoder.decodeFile(oggBuffer);
  decoder.free();
  return channelData[0] ?? new Float32Array(0);
}

/** Trascrive audio PCM mono a 16kHz gia' pronto (usata anche da transcribeTest.ts per un test isolato, senza dover fabbricare un file Ogg/Opus). */
export async function transcribePcm(pcm: Float32Array): Promise<string> {
  if (pcm.length === 0) return "";
  const transcriber = await getTranscriber();
  const result = await transcriber(pcm, { language: "italian", task: "transcribe" });
  const output = Array.isArray(result) ? result[0] : result;
  return output.text.trim();
}

/**
 * Trascrive un vocale WhatsApp in testo italiano. Tutto in locale (Whisper via
 * WASM/ONNX Runtime): nessuna chiamata API a pagamento, nessun costo per
 * messaggio.
 */
export async function transcribeVoiceNote(oggBuffer: Buffer): Promise<string> {
  const pcm = await decodeVoiceNoteToPcm16k(oggBuffer);
  return transcribePcm(pcm);
}
