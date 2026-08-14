import { connectWhatsApp, getSelfJid } from "./whatsapp/connection.js";

async function main() {
  console.log("Personal Assistant: avvio connessione WhatsApp...");

  await connectWhatsApp(async (sock) => {
    const selfJid = getSelfJid(sock);
    await sock.sendMessage(selfJid, {
      text: "Test di connessione riuscito: il tuo assistente personale e' collegato a WhatsApp.",
    });
    console.log("Messaggio di test inviato a te stesso.");
  });
}

main().catch((err) => {
  console.error("Errore durante l'avvio:", err);
  process.exit(1);
});
