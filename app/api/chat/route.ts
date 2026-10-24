import type { UIMessage } from "ai";
import { chatRequestSchema, runChat } from "@/lib/ai/chat";

export const maxDuration = 30;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "assistant_offline", message: "The assistant is offline right now." }, { status: 503 });
  }
  const parsed = chatRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request", message: "Invalid chat request." }, { status: 400 });

  const result = await runChat(parsed.data);
  if (!result) return Response.json({ error: "unknown_costume", message: "Unknown costume." }, { status: 404 });
  // originalMessages makes a tool-result continuation extend the same assistant message instead of starting a new one.
  return result.toUIMessageStreamResponse({ originalMessages: parsed.data.messages as UIMessage[] });
}
