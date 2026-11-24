/** Isolated LiveKit proof-of-voice. NO SNOOP account binding, no mutations, no navigation. */
import { Agent, ServerOptions, cli, defineAgent, inference, voice } from '@livekit/agents';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({path: '.env.local'});

const agent = defineAgent({
  entry: async (ctx) => {
    const session = new voice.AgentSession({
      stt: new inference.STT({model:'deepgram/nova-3',language:'multi'}),
      tts: new inference.TTS({model:'cartesia/sonic-3',voice:'9626c31c-bec5-4cca-baa8-f8ba9e84c8bc'}),
      turnHandling: {turnDetection: new inference.TurnDetector()},
    });
    await session.start({
      agent: Agent.create({
        instructions:`Sei JARVIS, prototipo vocale isolato di SNOOP. Rispondi in spagnolo,
oppure italiano se richiesto. Sii conciso e naturale. Questo ambiente è
SOLO una prova di audio/turn-taking: non hai alcun accesso a soci, prodotti,
stock, cassa, ordini, informazioni private o applicazioni. Non simulare azioni,
non inventare dati e non dichiarare che hai aperto pagine. Per comandi reali
spiega: "La conexión con SNOOP todavía no está activa en este prototipo."
Evita di richiedere nomi reali, documenti o informazioni personali.`,
        llm: new inference.LLM({model:'google/gemma-4-31b-it'}),
      }),
      room:ctx.room,
    });
    await ctx.connect();
    session.generateReply({instructions:'Saluda brevemente y di que el modo de prueba de voz está activo, sin acceso a los datos del club.'});
  }
});
export default agent;
cli.runApp(new ServerOptions({agent:fileURLToPath(import.meta.url),agentName:'snoop-jarvis-livekit-lab'}));
