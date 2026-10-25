"use client";

import { getToolName, isToolUIPart, type UIMessage } from "ai";
import type { ProductCard as Card } from "@/lib/ai/cards";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Tool } from "@/components/ai-elements/tool";
import { formatPrice } from "@/lib/cart/context";
import { ProductCard } from "./product-card";

const labels: Record<string, string> = {
  getCostume: "Costume pieces",
  assembleOutfit: "Your styled outfit",
  getAlternatives: "Catalog alternatives",
  getMerchantCatalog: "More from this shop",
  getFewestShops: "Pieces from the same shop",
  getPickPath: "Product lookup",
  recordSizes: "Your sizes",
  addToCart: "Your cart",
};

type Output = Record<string, unknown> | undefined;

function summarize(name: string, output: Output, pieceNames: Record<string, string>): string {
  if (!output) return "Checking the catalog…";
  if (typeof output.error === "string") return output.error;
  switch (name) {
    case "assembleOutfit": return typeof output.totalCents === "number" && typeof output.budgetCents === "number"
      ? `${formatPrice(output.totalCents)} of your ${formatPrice(output.budgetCents)} pieces budget. Shipping and tax extra.` : "Outfit comparison complete.";
    case "recordSizes": {
      const saved = (output.saved as { sizeKind: string; pieceId?: string; size: string }[] | undefined) ?? [];
      return saved.length ? `Saved: ${saved.map((s) => `${s.pieceId ? pieceNames[s.pieceId] ?? s.pieceId : s.sizeKind}: ${s.size}`).join(", ")}.` : "No sizes changed.";
    }
    case "addToCart": return output.title ? `Added ${String(output.title)}.` : "Cart updated.";
    case "getCostume": return "These are the pieces and checked merchant picks for this look.";
    case "getFewestShops": return Array.isArray(output.shops) && output.shops.length ? "These shops cover more than one selected piece." : "No shop in the catalog covers more than one selected piece.";
    default: return Array.isArray(output.products) ? `${output.products.length} catalog ${output.products.length === 1 ? "pick" : "picks"} found.` : "Catalog checked.";
  }
}

type ToolPart = Extract<UIMessage["parts"][number], { toolCallId: string }>;
type Segment = { kind: "text"; key: string; text: string } | { kind: "tool"; key: string; name: string; parts: ToolPart[] };

/** Consecutive calls to the same tool (one lookup per costume piece) read as one step, so they share a row. */
function segment(parts: UIMessage["parts"]): Segment[] {
  const segments: Segment[] = [];
  parts.forEach((part, index) => {
    if (part.type === "text") { if (part.text) segments.push({ kind: "text", key: String(index), text: part.text }); return; }
    if (!isToolUIPart(part)) return;
    const name = getToolName(part);
    const failed = part.state === "output-error" || part.state === "output-denied";
    if (name === "getPickPath" && !failed) return;
    const last = segments.at(-1);
    if (last?.kind === "tool" && last.name === name && !failed && !last.parts.some((p) => p.state === "output-error" || p.state === "output-denied")) last.parts.push(part);
    else segments.push({ kind: "tool", key: part.toolCallId, name, parts: [part] });
  });
  return segments;
}

export function MessageView({ message, cartProductIds, pieceNames, onAdd }: {
  message: UIMessage;
  cartProductIds: Set<string>;
  pieceNames: Record<string, string>;
  onAdd: (card: Card) => void;
}) {
  // The model may look up the same piece twice in one reply; show each product card once.
  const shown = new Set<string>();
  return (
    <Message from={message.role}>
      {segment(message.parts).map((seg) => {
        if (seg.kind === "text") return <MessageContent key={seg.key}>{message.role === "user" ? <p className="whitespace-pre-wrap">{seg.text}</p> : <MessageResponse>{seg.text}</MessageResponse>}</MessageContent>;
        const { name, parts } = seg;
        const failedPart = parts.find((part) => part.state === "output-error" || part.state === "output-denied");
        const pending = parts.find((part) => part.state !== "output-available" && part !== failedPart);
        const state = failedPart?.state ?? pending?.state ?? "output-available";
        const outputs = parts.map((part) => (part.state === "output-available" ? part.output as Output : undefined));
        const products = outputs.flatMap((output) => (output?.products as Card[] | undefined) ?? (Array.isArray(output?.shops) ? (output.shops as { products: Card[] }[]).flatMap((shop) => shop.products) : []));
        const uniqueProducts = products.filter((card) => {
          const key = `${card.pieceId}-${card.productId}`;
          if (shown.has(key)) return false;
          shown.add(key);
          return true;
        });
        const summary = failedPart
          ? ("errorText" in failedPart ? failedPart.errorText ?? "" : "This action did not complete.")
          : parts.length > 1 && uniqueProducts.length && name !== "assembleOutfit"
            ? `${uniqueProducts.length} catalog ${uniqueProducts.length === 1 ? "pick" : "picks"} across ${parts.length} lookups.`
            : summarize(name, outputs.at(-1), pieceNames);
        return (
          <div key={seg.key} className="flex w-full flex-col gap-2">
            <Tool title={labels[name] ?? "Catalog lookup"} state={state} summary={summary} />
            {uniqueProducts.length > 0 && <ul className="ai-products">{uniqueProducts.map((card) => <ProductCard key={`${card.pieceId}-${card.productId}`} card={card} inCart={cartProductIds.has(card.productId)} onAdd={onAdd} />)}</ul>}
          </div>
        );
      })}
    </Message>
  );
}
