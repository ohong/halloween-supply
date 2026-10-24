import { convertToModelMessages, isStepCount, isToolUIPart, safeValidateUIMessages, streamText, type UIMessage } from "ai";
import { getCostume } from "@/lib/catalog";
import { sonnet } from "@/lib/ai/models";
import { buildSystemPrompt } from "@/lib/ai/prompt";
import { createTools } from "@/lib/ai/tools";
import { chatContextSchema } from "@/lib/ai/chat-context";
import { addToCartSchema, recordSizesSchema } from "@/lib/ai/client-tools";
import type { CostumeView } from "@/lib/types";

export const maxDuration = 60;

const MAX_REQUEST_BYTES = 150_000;
const fail = (status: number, message: string) => Response.json({ error: message }, { status });

/** Rebuild client tool receipts; never send browser-supplied catalog results to the model. */
function groundHistory(messages: UIMessage[], view: CostumeView): UIMessage[] {
  const callIds = new Set<string>();
  return messages.map((message) => {
    if (message.role === "system") throw new Error("System messages are not accepted.");
    const parts: UIMessage["parts"] = [];
    for (const part of message.parts) {
      if (part.type === "text") {
        if (part.text.length > 6000) throw new Error("Please keep each message under 6,000 characters.");
        parts.push({ type: "text", text: part.text });
        continue;
      }
      if (part.type === "step-start" && message.role === "assistant") continue;
      if (!isToolUIPart(part) || message.role !== "assistant" || part.type === "dynamic-tool") throw new Error("Unsupported message content.");
      if (callIds.has(part.toolCallId)) throw new Error("A tool call was repeated.");
      callIds.add(part.toolCallId);

      // Server lookups run again when needed. Their supplied history is untrusted.
      if (part.type !== "tool-recordSizes" && part.type !== "tool-addToCart") continue;
      if (part.state !== "output-available" && part.state !== "output-error") throw new Error("Finish the cart action before sending another message.");
      if (part.state === "output-error") {
        parts.push({ ...part, errorText: "The cart action did not complete." });
        continue;
      }
      if (part.type === "tool-recordSizes") {
        const input = recordSizesSchema.parse(part.input);
        parts.push({ ...part, input, output: { saved: input.sizes } });
      } else {
        const input = addToCartSchema.parse(part.input);
        const piece = view.pieces.find(({ piece }) => piece.id === input.pieceId);
        const option = piece?.options.find(({ product }) => product.id === input.productId && product.availability !== "out_of_stock");
        if (!option) throw new Error("That cart product is not available for this costume.");
        parts.push({ ...part, input, output: { ok: true, ...input, title: option.product.title } });
      }
    }
    return { id: message.id, role: message.role, parts };
  }).filter((message) => message.parts.length > 0);
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return fail(403, "Send the message from this site's assistant.");
  if (Number(req.headers.get("content-length") || 0) > MAX_REQUEST_BYTES) return fail(413, "This conversation is too long. Start a new conversation.");

  let body: unknown;
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) return fail(413, "This conversation is too long. Start a new conversation.");
    body = JSON.parse(raw);
  } catch {
    return fail(400, "Invalid request body.");
  }
  if (!body || typeof body !== "object") return fail(400, "Expected messages and a costume context.");
  const { messages, context } = body as Record<string, unknown>;
  const parsedContext = chatContextSchema.safeParse(context);
  if (!parsedContext.success || !Array.isArray(messages) || messages.length < 1 || messages.length > 50) return fail(400, "Send up to 50 messages with a valid costume, cart and sizes.");
  if (!process.env.ANTHROPIC_API_KEY) return fail(503, "The shopping assistant is temporarily unavailable.");

  const ctx = parsedContext.data;
  const view = await getCostume(ctx.costumeSlug);
  if (!view) return fail(404, "That costume is not in the catalog.");
  if (new Set(ctx.cart.map((line) => line.pieceId)).size !== ctx.cart.length || ctx.cart.some((line) => !view.pieces.some(({ piece, options }) => piece.id === line.pieceId && options.some(({ product }) => product.id === line.productId)))) return fail(400, "The cart contains a product outside this costume.");

  const tools = createTools(view);
  const validated = await safeValidateUIMessages({ messages, tools });
  if (!validated.success) return fail(400, "The conversation contains an invalid message or cart action.");

  try {
    const history = groundHistory(validated.data, view);
    if (history.length === 0) return fail(400, "Send a message to the assistant.");
    const result = streamText({
      model: sonnet(),
      instructions: buildSystemPrompt(view, ctx),
      messages: await convertToModelMessages(history, { tools }),
      tools,
      stopWhen: isStepCount(6),
      maxOutputTokens: 1800,
      maxRetries: 1,
      abortSignal: AbortSignal.any([req.signal, AbortSignal.timeout(55_000)]),
    });

    return result.toUIMessageStreamResponse({
      onError: (error) => {
        // Provider errors can contain request details. Keep them out of the UI and logs.
        console.error("[chat] stream failed", error instanceof Error ? error.name : "UnknownError");
        return "The assistant could not finish. Please try again.";
      },
    });
  } catch {
    return fail(400, "The conversation contains an invalid or repeated cart action. Start a new conversation.");
  }
}
