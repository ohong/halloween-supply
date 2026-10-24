"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useEffect, useMemo, useRef } from "react";
import type { AssistantMessage } from "@/lib/ai/types";
import { useCart } from "@/lib/cart/context";
import { toCartItem } from "@/lib/cart/item";
import type { CartItem, CostumeView, ProductOption } from "@/lib/types";
import { Conversation } from "./conversation";
import { Message, MessageText } from "./message";
import { ProductCard } from "./product-card";
import { PromptInput } from "./prompt-input";
import { ToolStatus } from "./tool-status";

const CHIPS = [
  "I'm a medium, size 10 boots",
  "Something cheaper for the hat",
  "Only local shops",
  "What else does this shop sell?",
];

const SERVER_TOOL_LABELS: Record<string, [string, string]> = {
  getCostumePieces: ["Checking the pieces", "Checked the pieces"],
  findAlternatives: ["Looking for alternatives", "Found alternatives"],
  whatElseDoesShopSell: ["Checking the shop's catalog", "Checked the shop's catalog"],
  explainPick: ["Tracing why it was picked", "Traced why it was picked"],
};

function errorCopy(error: Error | undefined): string | null {
  if (!error) return null;
  return /assistant_offline|offline/i.test(error.message)
    ? "The assistant is offline right now."
    : "Something went wrong. Please try again.";
}

/** The shopping assistant chat panel for a costume page. */
export function AssistantPanel({ costume }: { costume: CostumeView }) {
  const cart = useCart();
  const { add, setSize } = cart;

  // The newest cart, readable synchronously: tool handlers update it before the
  // follow-up request is sent, and the transport reads it for every request.
  const cartRef = useRef<CartItem[]>(cart.items);
  useEffect(() => {
    cartRef.current = cart.items;
  }, [cart.items]);

  const slug = costume.costume.slug;
  const options = useMemo(() => {
    const map = new Map<string, { piece: CostumeView["pieces"][number]["piece"]; option: ProductOption }>();
    for (const pv of costume.pieces) for (const option of pv.options) map.set(`${pv.piece.id}:${option.product.id}`, { piece: pv.piece, option });
    return map;
  }, [costume]);

  // The body callback only runs when a request is sent, never during render.
  const transport = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- body() runs per request, not during render
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({
          costumeSlug: slug,
          cart: cartRef.current.map(({ pieceId, productId, size }) => ({ pieceId, productId, size })),
        }),
      }),
    [slug],
  );

  const addOption = (pieceId: string, productId: string): CartItem | null => {
    const hit = options.get(`${pieceId}:${productId}`);
    if (!hit) return null;
    const existing = cartRef.current.find((l) => l.pieceId === pieceId);
    const item = toCartItem(hit.piece, hit.option, existing?.size ?? null);
    cartRef.current = existing ? cartRef.current.map((l) => (l.pieceId === pieceId ? item : l)) : [...cartRef.current, item];
    add(item);
    return item;
  };

  const { messages, sendMessage, addToolOutput, status, error, stop } = useChat<AssistantMessage>({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall({ toolCall }) {
      if (toolCall.dynamic) return;
      const id = toolCall.toolCallId;
      switch (toolCall.toolName) {
        case "recordSizes": {
          const applied: Array<{ pieceId: string; size: string }> = [];
          const notInCart: string[] = [];
          const unknown: string[] = [];
          for (const { pieceId, size } of toolCall.input.sizes) {
            if (!costume.pieces.some((p) => p.piece.id === pieceId)) unknown.push(pieceId);
            else if (!cartRef.current.some((l) => l.pieceId === pieceId)) notInCart.push(pieceId);
            else {
              cartRef.current = cartRef.current.map((l) => (l.pieceId === pieceId ? { ...l, size } : l));
              setSize(pieceId, size);
              applied.push({ pieceId, size });
            }
          }
          addToolOutput({ tool: "recordSizes", toolCallId: id, output: { applied, notInCartYet: notInCart, unknownPieces: unknown } });
          break;
        }
        case "addToCart": {
          const { pieceId, productId } = toolCall.input;
          const item = addOption(pieceId, productId);
          addToolOutput({
            tool: "addToCart",
            toolCallId: id,
            output: item
              ? { added: true, piece: item.pieceName, title: item.title, merchant: item.merchantName, priceCents: item.priceCents, size: item.size }
              : { added: false, reason: "That product is not an option for that piece." },
          });
          break;
        }
        case "showProducts": {
          const { pieceId, productIds } = toolCall.input;
          const missing = productIds.filter((p) => !options.has(`${pieceId}:${p}`));
          addToolOutput({ tool: "showProducts", toolCallId: id, output: missing.length ? `shown, but unknown ids: ${missing.join(", ")}` : "shown" });
          break;
        }
      }
    },
  });

  const busy = status === "submitted" || status === "streaming";
  const errText = errorCopy(error);
  const offline = errText === "The assistant is offline right now.";

  const send = (text: string) => void sendMessage({ text });

  return (
    <section
      aria-label="Shopping assistant"
      className="flex h-[min(640px,80dvh)] w-full flex-col overflow-hidden rounded-[4px] border border-[#CCC] bg-white font-[family-name:var(--font-geist-sans)] text-[#333]"
    >
      <header className="border-b border-[#CCC] px-4 py-3">
        <h2 className="m-0 text-[15px] font-normal tracking-[0.01em]">Shopping assistant</h2>
        <p className="m-0 text-[12px] text-[#666]">Sizes, swaps, and questions about the pieces.</p>
      </header>

      <Conversation trigger={`${messages.length}:${status}:${messages.at(-1)?.parts.length ?? 0}`}>
        {messages.length === 0 && (
          <div className="flex flex-col items-start gap-2">
            <p className="m-0 text-[14px] leading-[1.5] text-[#666]">
              Tell me your sizes, or ask me anything about these pieces.
            </p>
            <div className="flex flex-wrap gap-2">
              {CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => send(chip)}
                  className="min-h-[36px] rounded-full bg-[#EFEEEF] px-3 text-[13px] text-[#333] transition-colors duration-150 ease-in-out hover:bg-[#CCC]"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <Message key={message.id} from={message.role === "user" ? "user" : "assistant"}>
            {message.parts.map((part, i) => {
              if (part.type === "text") {
                return part.text ? (
                  <MessageText key={i} from={message.role === "user" ? "user" : "assistant"}>
                    {part.text}
                  </MessageText>
                ) : null;
              }
              if (part.type === "tool-showProducts") {
                if (part.state === "input-streaming") return null;
                if (!part.input) return null;
                const input = part.input;
                const cards = input.productIds.flatMap((pid) => {
                  const hit = options.get(`${input.pieceId}:${pid}`);
                  return hit ? [{ pid, ...hit }] : [];
                });
                if (!cards.length) return null;
                return (
                  <div key={part.toolCallId} className="-mx-4 flex w-[calc(100%+32px)] snap-x gap-2 overflow-x-auto px-4 pb-1">
                    {cards.map(({ pid, piece, option }) => (
                      <ProductCard
                        key={pid}
                        option={option}
                        inCart={cart.items.some((l) => l.pieceId === piece.id && l.productId === pid)}
                        onAdd={() => addOption(piece.id, pid)}
                      />
                    ))}
                  </div>
                );
              }
              if (part.type === "tool-recordSizes") {
                return <ToolStatus key={part.toolCallId} label={part.state === "output-available" ? "Sizes saved" : "Saving sizes"} state={part.state === "output-error" ? "error" : part.state === "output-available" ? "done" : "running"} />;
              }
              if (part.type === "tool-addToCart") {
                return <ToolStatus key={part.toolCallId} label={part.state === "output-available" ? "Added to cart" : "Adding to cart"} state={part.state === "output-error" ? "error" : part.state === "output-available" ? "done" : "running"} />;
              }
              if (part.type.startsWith("tool-")) {
                const name = part.type.slice(5);
                const labels = SERVER_TOOL_LABELS[name];
                if (!labels || !("state" in part)) return null;
                const done = part.state === "output-available";
                return <ToolStatus key={(part as { toolCallId: string }).toolCallId} label={done ? labels[1] : labels[0]} state={part.state === "output-error" ? "error" : done ? "done" : "running"} />;
              }
              return null;
            })}
          </Message>
        ))}

        {status === "submitted" && <ToolStatus label="Thinking" state="running" />}
        {errText && (
          <p role="alert" className={`m-0 rounded-[4px] px-3 py-2 text-[13px] ${offline ? "bg-[#EFEEEF] text-[#333]" : "border border-[#CCC] text-[#333]"}`}>
            {errText}
          </p>
        )}
      </Conversation>

      <PromptInput onSubmit={send} busy={busy} onStop={stop} />
    </section>
  );
}
