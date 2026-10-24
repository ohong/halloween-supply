import "server-only";

import { convertToModelMessages, isStepCount, streamText, type LanguageModel, type UIMessage } from "ai";
import { z } from "zod";
import { getCostume } from "../catalog";
import { sonnet } from "./models";
import { buildSystemPrompt } from "./prompt";
import { createTools } from "./tools";

export const chatRequestSchema = z.object({
  messages: z.array(z.any()).min(1).max(60),
  costumeSlug: z.string().min(1).max(100),
  cart: z
    .array(z.object({ pieceId: z.string(), productId: z.string(), size: z.string().nullable().optional().transform((s) => s ?? null) }))
    .max(30)
    .default([]),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** The whole chat turn as one streamText call; the route and the tests share it. */
export async function runChat(req: ChatRequest, model: LanguageModel = sonnet()) {
  const view = await getCostume(req.costumeSlug);
  if (!view) return null;
  const tools = createTools(req.costumeSlug);
  return streamText({
    model,
    instructions: buildSystemPrompt(view, req.cart),
    messages: await convertToModelMessages(req.messages as UIMessage[], { tools }),
    tools,
    stopWhen: isStepCount(5),
  });
}
