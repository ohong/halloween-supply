import { convertToModelMessages, isStepCount, isToolUIPart, safeValidateUIMessages, streamText, type UIMessage } from "ai";
import { getCostume } from "@/lib/catalog";
import { sonnet } from "@/lib/ai/models";
import { buildSystemPrompt } from "@/lib/ai/prompt";
import { createTools } from "@/lib/ai/tools";
import { chatContextSchema, type ChatContext } from "@/lib/ai/chat-context";
import { addToCartSchema, recordSizesSchema } from "@/lib/ai/client-tools";
import { sizeMatches } from "@/lib/outfits";
import type { CostumeView } from "@/lib/types";

export const maxDuration = 300;

const MAX_REQUEST_BYTES = 150_000;
const fail = (status: number, message: string) => Response.json({ error: message }, { status });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function revalidateOutfitHistory(output: unknown, input: unknown, view: CostumeView, context: ChatContext) {
  const unavailable = {
    error: "The earlier outfit selections could not be revalidated. Compare the outfit again before changing the cart.",
    products: [], cartChanged: false,
  };
  if (!isRecord(input) || !Number.isSafeInteger(input.budgetCents) || Number(input.budgetCents) < 0
    || !isRecord(output) || "error" in output || !Array.isArray(output.products)) return unavailable;
  const owned = Array.isArray(input.ownedPieceIds) ? input.ownedPieceIds : [];
  const skipped = Array.isArray(input.skippedPieceIds) ? input.skippedPieceIds : [];
  const excluded = [...owned, ...skipped];
  if (new Set(excluded).size !== excluded.length
    || excluded.some((id) => typeof id !== "string" || !view.pieces.some(({ piece }) => piece.id === id))
    || skipped.some((id) => view.pieces.some(({ piece }) => piece.id === id && piece.required))) return unavailable;
  const needed = view.pieces.filter(({ piece }) => !excluded.includes(piece.id));
  if (output.products.length !== needed.length) return unavailable;
  const products = [];
  const seen = new Set<string>();
  for (const value of output.products) {
    if (!isRecord(value)) return unavailable;
    const selected = addToCartSchema.safeParse({ pieceId: value.pieceId, productId: value.productId });
    if (!selected.success || seen.has(selected.data.pieceId)) return unavailable;
    const piece = needed.find(({ piece }) => piece.id === selected.data.pieceId);
    const option = piece?.options.find(({ product }) => product.id === selected.data.productId && product.availability !== "out_of_stock");
    if (!piece || !option) return unavailable;
    const savedPieceSize = context.pieceSizes?.[piece.piece.id]
      ?? context.cart.find((line) => line.pieceId === piece.piece.id)?.size;
    const previousSize = (isRecord(input.pieceSizes) ? input.pieceSizes[piece.piece.id] : undefined)
      ?? savedPieceSize ?? (isRecord(input.sizes) ? input.sizes[piece.piece.sizeKind] : undefined);
    const currentSize = savedPieceSize ?? context.sizes[piece.piece.sizeKind];
    if (previousSize !== undefined && (typeof previousSize !== "string" || !sizeMatches(option, previousSize))
      || currentSize && !sizeMatches(option, currentSize)) return unavailable;
    seen.add(selected.data.pieceId);
    products.push({ ...selected.data, title: option.product.title, priceCents: option.product.priceCents,
      merchant: option.merchant.name, availability: option.product.availability, sizes: option.product.sizes });
  }
  const totalCents = products.reduce((total, product) => total + product.priceCents, 0);
  if (totalCents > Number(input.budgetCents)) return unavailable;
  // Browser history identifies the selections; only current catalog facts are
  // vouched for here. This does not authenticate an earlier Decisions response.
  return {
    historySource: "browser_selections_revalidated_against_current_catalog",
    note: "These are revalidated current catalog selections, not proof of a previous Decisions response. Prices and stock can change; do not claim confirmed sizes or event delivery.",
    products, totalCents, budgetCents: input.budgetCents, ownedPieceIds: owned, skippedPieceIds: skipped, cartChanged: false,
  };
}

/** Rebuild client tool receipts; never send browser-supplied catalog results to the model. */
function groundHistory(messages: UIMessage[], view: CostumeView, context: ChatContext): UIMessage[] {
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
      // Provider thinking and display metadata can accompany genuine tool calls.
      // They are not cart receipts and browser-supplied metadata is never replayed.
      if (message.role === "assistant" && ["step-start", "reasoning", "reasoning-file", "custom", "source-url", "source-document"].includes(part.type)) continue;
      if (!isToolUIPart(part) || message.role !== "assistant" || part.type === "dynamic-tool") throw new Error("Unsupported message content.");
      if (callIds.has(part.toolCallId)) throw new Error("A tool call was repeated.");
      callIds.add(part.toolCallId);

      if (part.type === "tool-assembleOutfit") {
        if (part.state === "output-available") {
          parts.push({ type: part.type, toolCallId: part.toolCallId, state: "output-available", input: part.input,
            output: revalidateOutfitHistory(part.output, part.input, view, context) });
        } else if (part.state === "output-error") {
          parts.push({ type: part.type, toolCallId: part.toolCallId, state: "output-error", input: part.input,
            errorText: "The earlier outfit comparison did not complete." });
        } else throw new Error("Finish the outfit comparison before sending another message.");
        continue;
      }
      // Server lookups run again when needed. Their supplied history is untrusted.
      if (part.type !== "tool-recordSizes" && part.type !== "tool-addToCart") continue;
      if (part.state !== "output-available" && part.state !== "output-error") throw new Error("Finish the cart action before sending another message.");
      if (part.state === "output-error") {
        parts.push({ ...part, errorText: "The cart action did not complete." });
        continue;
      }
      if (part.type === "tool-recordSizes") {
        const input = recordSizesSchema.parse(part.input);
        if (input.sizes.some((entry) => entry.pieceId !== undefined && !view.pieces.some(({ piece }) => piece.id === entry.pieceId && piece.sizeKind === entry.sizeKind))) throw new Error("That size does not belong to a piece in this costume.");
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
  if (Object.keys(ctx.pieceSizes).some((pieceId) => !view.pieces.some(({ piece }) => piece.id === pieceId && piece.sizeKind !== "one_size"))) return fail(400, "The saved sizes contain a piece outside this costume or a one-size accessory.");
  if (new Set(ctx.cart.map((line) => line.pieceId)).size !== ctx.cart.length || ctx.cart.some((line) => !view.pieces.some(({ piece, options }) => piece.id === line.pieceId && options.some(({ product }) => product.id === line.productId)))) return fail(400, "The cart contains a product outside this costume.");

  const tools = createTools(view, ctx);
  const validated = await safeValidateUIMessages({ messages, tools });
  if (!validated.success) return fail(400, "The conversation contains an invalid message or cart action.");

  try {
    const history = groundHistory(validated.data, view, ctx);
    if (history.length === 0) return fail(400, "Send a message to the assistant.");
    const result = streamText({
      model: sonnet(),
      instructions: buildSystemPrompt(view, ctx),
      messages: await convertToModelMessages(history, { tools }),
      tools,
      stopWhen: isStepCount(6),
      maxOutputTokens: 1800,
      maxRetries: 1,
      abortSignal: AbortSignal.any([req.signal, AbortSignal.timeout(270_000)]),
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
