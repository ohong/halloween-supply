import { mirrorSessionSeconds } from "@/lib/try-on-policy";
import { inventoryOverview, readMirrorInventory } from "@/lib/live-mirror/catalog-server";
import { GEMINI_LIVE_MODEL, GEMINI_VOICE_NAME, geminiInstructions, geminiTools, mintGeminiToken } from "@/lib/live-mirror/gemini-server";
import { requestBase, validatedCostume, voiceFailure, voiceRequestOrigin, voiceResponse, VoiceError } from "@/lib/live-mirror/voice-server";

export const maxDuration = 40;
const schema = requestBase.strict();

export async function GET() {
  return voiceResponse({ voiceAvailable: Boolean(process.env.GEMINI_API_KEY) });
}

export async function POST(request: Request) {
  try {
    voiceRequestOrigin(request);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new VoiceError(415, "Send a JSON request.");
    if (!process.env.GEMINI_API_KEY) throw new VoiceError(503, "Voice styling is not available yet. You can still choose pieces below.");
    if (Number(request.headers.get("content-length") ?? 0) > 65_536) throw new VoiceError(413, "The request is too large.");
    const { costumeSlug, outfit } = schema.parse(await request.json());
    const inventory = await readMirrorInventory();
    const costume = await validatedCostume(costumeSlug, outfit, inventory.views);
    const model = `models/${GEMINI_LIVE_MODEL}`;
    const token = await mintGeminiToken({
      model,
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE_NAME } } } },
      systemInstruction: { parts: [{ text: geminiInstructions(costume, outfit, inventoryOverview(inventory)) }] },
      tools: geminiTools,
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    }, request.signal);
    return voiceResponse({ token, model, voice: GEMINI_VOICE_NAME, catalog: inventory.looks, maxSessionSeconds: mirrorSessionSeconds() }, 201);
  } catch (error) { return voiceFailure(error); }
}
