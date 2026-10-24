"use client";

import { getToolName, isToolUIPart, type UIMessage } from "ai";
import type { ProductCard as Card } from "@/lib/ai/cards";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Tool, ToolContent, ToolHeader, ToolOutput } from "@/components/ai-elements/tool";
import { ProductCard } from "./product-card";

const labels: Record<string, string> = {
  getCostume: "Costume pieces",
  getAlternatives: "Catalog alternatives",
  getMerchantCatalog: "More from this shop",
  getFewestShops: "Pieces from the same shop",
  getPickPath: "Why this pick",
  recordSizes: "Your sizes",
  addToCart: "Your cart",
};

type Output = Record<string, unknown> | undefined;

function summarize(name: string, output: Output): string {
  if (!output) return "Checking the catalog…";
  if (typeof output.error === "string") return output.error;
  switch (name) {
    case "recordSizes": {
      const saved = (output.saved as { sizeKind: string; size: string }[] | undefined) ?? [];
      return saved.length ? `Saved: ${saved.map((s) => `${s.sizeKind} ${s.size}`).join(", ")}.` : "No sizes changed.";
    }
    case "addToCart": return output.title ? `Added ${String(output.title)}.` : "Cart updated.";
    case "getPickPath": return `${String(output.reason ?? "")}${Array.isArray(output.path) ? ` ${output.path.join(" → ")}` : ""}`;
    case "getCostume": return "These are the pieces and checked merchant picks for this look.";
    case "getFewestShops": return Array.isArray(output.shops) && output.shops.length ? "These shops cover more than one selected piece." : "No shop in the catalog covers more than one selected piece.";
    default: return Array.isArray(output.products) ? `${output.products.length} catalog ${output.products.length === 1 ? "pick" : "picks"} found.` : "Catalog checked.";
  }
}

export function MessageView({ message, cartProductIds, onAdd }: {
  message: UIMessage;
  cartProductIds: Set<string>;
  onAdd: (card: Card) => void;
}) {
  return (
    <Message from={message.role}>
      {message.parts.map((part, index) => {
        if (part.type === "text") return part.text ? <MessageContent key={index}><p className="whitespace-pre-wrap leading-relaxed">{part.text}</p></MessageContent> : null;
        if (!isToolUIPart(part)) return null;
        const name = getToolName(part);
        const output = part.state === "output-available" ? part.output as Output : undefined;
        const failed = part.state === "output-error" || part.state === "output-denied";
        const products = (output?.products as Card[] | undefined) ?? (Array.isArray(output?.shops) ? (output.shops as { products: Card[] }[]).flatMap((shop) => shop.products) : []);
        const uniqueProducts = products.filter((card, i) => products.findIndex((other) => other.pieceId === card.pieceId && other.productId === card.productId) === i);
        const summary = failed ? ("errorText" in part ? part.errorText : "This action did not complete.") : summarize(name, output);
        return (
          <div key={part.toolCallId} className="flex w-full flex-col gap-2">
            <Tool defaultOpen={failed || name === "recordSizes" || name === "addToCart"}>
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
