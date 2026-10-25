"use client";

import { getToolName, isToolUIPart, type UIMessage } from "ai";
import type { ProductCard as Card } from "@/lib/ai/cards";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Tool, ToolContent, ToolHeader, ToolOutput } from "@/components/ai-elements/tool";
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
      {message.parts.map((part, index) => {
        if (part.type === "text") return part.text ? <MessageContent key={index}><p className="whitespace-pre-wrap leading-relaxed">{part.text}</p></MessageContent> : null;
        if (!isToolUIPart(part)) return null;
        const name = getToolName(part);
        const output = part.state === "output-available" ? part.output as Output : undefined;
        const failed = part.state === "output-error" || part.state === "output-denied";
        if (name === "getPickPath" && !failed) return null;
        const products = (output?.products as Card[] | undefined) ?? (Array.isArray(output?.shops) ? (output.shops as { products: Card[] }[]).flatMap((shop) => shop.products) : []);
        const uniqueProducts = products.filter((card) => {
          const key = `${card.pieceId}-${card.productId}`;
          if (shown.has(key)) return false;
          shown.add(key);
          return true;
        });
        const summary = failed ? ("errorText" in part ? part.errorText : "This action did not complete.") : summarize(name, output, pieceNames);
        return (
          <div key={part.toolCallId} className="flex w-full flex-col gap-2">
            <Tool defaultOpen={failed || name === "recordSizes" || name === "addToCart" || name === "assembleOutfit"}>
              <ToolHeader title={labels[name] ?? "Catalog lookup"} state={part.state} />
              <ToolContent><ToolOutput error={failed}>{summary}</ToolOutput></ToolContent>
            </Tool>
            {uniqueProducts.length > 0 && <ul className="flex w-full flex-col gap-2">{uniqueProducts.map((card) => <ProductCard key={`${card.pieceId}-${card.productId}`} card={card} inCart={cartProductIds.has(card.productId)} onAdd={onAdd} />)}</ul>}
          </div>
        );
      })}
    </Message>
  );
}
