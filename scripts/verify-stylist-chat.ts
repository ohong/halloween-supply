/** Real Anthropic -> assembleOutfit -> Decisions check. No checkout or cart write.
 * TURSO_DATABASE_URL='' TURSO_AUTH_TOKEN='' bun --env-file=.env.local scripts/verify-stylist-chat.ts http://localhost:3401
 * Calls both real providers using the running app's configured credentials.
 * --preflight-only verifies real cart-size constraints without provider requests.
 */
import assert from "node:assert/strict";
import type { UIMessage } from "ai";
import type { ProductCard } from "../lib/ai/cards";
import type { ChatContext } from "../lib/ai/chat-context";
import { enumerateOutfits } from "../lib/stylist/candidates";
import { requestedSize, sizeMatches, type ShoppingBrief } from "../lib/outfits";
import type { PieceView, ProductOption } from "../lib/types";

type BunRuntime = { plugin(plugin: { name: string; setup(build: { module(name: string, loader: () => unknown): void }): void }): void };
(globalThis as unknown as { Bun: BunRuntime }).Bun.plugin({
  name: "stylist-chat-verification-server-modules",
  setup(build) { build.module("server-only", () => ({ exports: {}, loader: "object" })); },
});
const { getCostume } = await import("../lib/catalog");
const { createTools } = await import("../lib/ai/tools");
const base = new URL(process.argv.find((argument) => /^https?:\/\//.test(argument)) ?? "http://127.0.0.1:3401").origin;
const view = await getCostume("velvet-vampire");
assert(view, "The real Velvet Vampire catalog is required.");
const cartWaistcoat = view.pieces.find(({ piece }) => piece.id === "black-waistcoat")?.options.find(({ product }) => product.sizes.includes("42"));
assert(cartWaistcoat, "The actual cart waistcoat must offer merchant label42.");
const context: ChatContext = {
  costumeSlug: view.costume.slug, sizes: { apparel: "Medium" },
  cart: [{ pieceId: "black-waistcoat", productId: cartWaistcoat.product.id, size: "42" }],
};
const brief: ShoppingBrief = { budget: "", eventDate: "", preference: "styling", sizes: context.sizes, pieceSizes: { "black-waistcoat": "42" } };
const feasible = enumerateOutfits(view, brief, {}).affordable;
const minimum = Math.min(...feasible.map((candidate) => candidate.total));
const maximum = Math.max(...feasible.map((candidate) => candidate.total));
const budgetCents = minimum + Math.floor((maximum - minimum) / 3);
// A one-cent request fails before any provider call, exercising the real tool's
// cart/context merge and exact catalog constraints without a mocked success.
const preflight = await createTools(view, context).assembleOutfit.execute!({ budgetCents: 1 }, { toolCallId: "cart-size-preflight", messages: [], context: {} });
assert("code" in preflight && preflight.code === "budget_too_low");
assert("minimumSubtotal" in preflight && preflight.minimumSubtotal === minimum, "Cart-only waistcoat42 must constrain the real minimum subtotal.");
const cleared = await createTools(view, context).assembleOutfit.execute!({ budgetCents: 1, pieceSizes: { "black-waistcoat": "" } }, { toolCallId: "cleared-cart-size-preflight", messages: [], context: {} });
const clearedMinimum = enumerateOutfits(view, { ...brief, pieceSizes: { "black-waistcoat": "" } }, {}).minimumSubtotal;
assert("code" in cleared && cleared.code === "budget_too_low");
assert("minimumSubtotal" in cleared && cleared.minimumSubtotal === clearedMinimum && clearedMinimum < minimum, "Explicit empty per-piece input must override the cart label and suppress generic fallback.");
console.log("PASS real tool preflight preserves cart-only waistcoat42; explicit empty override clears it without provider calls.");
if (process.argv.includes("--preflight-only")) process.exit(0);
const messages: UIMessage[] = [{ id: crypto.randomUUID(), role: "user", parts: [{
  type: "text", text: `I have $${(budgetCents / 100).toFixed(2)} TOTAL for the whole Velvet Vampire costume. Choose a complete outfit that fits that total. Keep my saved exact merchant sizes. I do not own any pieces. Recommend it only; do not add anything to my cart.`,
}] }];
const response = await fetch(new URL("/api/chat", base), {
  method: "POST", headers: { "Content-Type": "application/json", Origin: base },
  body: JSON.stringify({ messages, context }), signal: AbortSignal.timeout(70_000), cache: "no-store",
});
assert.equal(response.status, 200, "The actual assistant request must succeed.");
assert(response.headers.get("content-type")?.includes("text/event-stream"));
const events = (await response.text()).split("\n").filter((line) => line.startsWith("data: ") && line.trim() !== "data: [DONE]").map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
assert(!events.some((event) => event.type === "error"), "The real Anthropic/Decisions stream must finish without provider errors.");
const calls = events.filter((event) => event.type === "tool-input-available" && event.toolName === "assembleOutfit");
assert.equal(calls.length, 1, "A total-budget request must call the whole-outfit tool once.");
assert.equal((calls[0].input as { budgetCents: number }).budgetCents, budgetCents, "The total costume budget must not become a per-piece cap.");
assert(!events.some((event) => event.type === "tool-input-available" && event.toolName === "addToCart"), "A recommendation must never change the cart automatically.");
const output = events.find((event) => event.type === "tool-output-available" && event.toolCallId === calls[0].toolCallId)?.output as {
  error?: string;
  method: string;
  products: ProductCard[];
  totalCents: number;
  budgetCents: number;
  cartChanged: boolean;
  evidence: { deliveryConfirmed: boolean; unknownStockPieces: string[]; unknownSizePieces: string[]; photoProductIds: string[] };
} | undefined;
assert(output, "The actual styling tool must return an output.");
assert.equal(output.error, undefined, output.error);
assert.equal(output.method, "decisions", "Anthropic must delegate the styling choice to the actual Decisions API.");
assert.equal(output.cartChanged, false);
assert.equal(output.budgetCents, budgetCents);
assert.equal(output.products.length, view.pieces.length);
assert.equal(new Set(output.products.map((card) => card.pieceId)).size, view.pieces.length);
let total = 0;
for (const card of output.products) {
  const piece: PieceView | undefined = view.pieces.find(({ piece: catalogPiece }) => catalogPiece.id === card.pieceId);
  const real: ProductOption | undefined = piece?.options.find(({ product }) => product.id === card.productId);
  assert(piece && real, "Every returned card must belong to this piece of the current real catalog.");
  assert.equal(card.priceCents, real.product.priceCents);
  assert.equal(card.priceTier, real.pick.priceTier);
  assert.notEqual(real.product.availability, "out_of_stock");
  assert(sizeMatches(real, requestedSize(brief, piece.piece)), "Saved piece-specific merchant sizes must survive the chat integration.");
  if (real.product.merchantImage) assert(output.evidence.photoProductIds.includes(card.productId));
  total += card.priceCents;
}
assert.equal(total, output.totalCents);
assert(total <= budgetCents, "The sum of all recommended product cards must fit the total budget.");
assert(output.products.find((card) => card.pieceId === "ruffled-shirt")?.sizes.includes("Medium"));
assert(output.products.find((card) => card.pieceId === "black-waistcoat")?.sizes.includes("42"));
assert.equal(output.evidence.deliveryConfirmed, false);
console.log(`PASS real Anthropic called assembleOutfit; actual Decisions selected ${output.products.length} scoped product cards totaling ${total} cents within a ${budgetCents}-cent total budget.`);
console.log("PASS saved shirt Medium and cart-only waistcoat42 were preserved; merchant photos were supplied; no cart or checkout action occurred.");

const followup: UIMessage[] = [
  ...messages,
  { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "tool-assembleOutfit", toolCallId: String(calls[0].toolCallId), state: "output-available", input: calls[0].input, output }] } as UIMessage,
  { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: "Repeat the exact five product IDs and total pieces subtotal from that recommendation. Use the previous result. Do not compare again, search, or change my cart." }] },
];
const recall = await fetch(new URL("/api/chat", base), {
  method: "POST", headers: { "Content-Type": "application/json", Origin: base },
  body: JSON.stringify({ messages: followup, context }), signal: AbortSignal.timeout(70_000), cache: "no-store",
});
assert.equal(recall.status, 200);
const recallEvents = (await recall.text()).split("\n").filter((line) => line.startsWith("data: ") && line.trim() !== "data: [DONE]").map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
assert(!recallEvents.some((event) => event.type === "error" || event.type === "tool-input-available"), "A follow-up recall must use the revalidated receipt without a new comparison or cart action.");
const recalled = recallEvents.filter((event) => event.type === "text-delta").map((event) => String(event.delta)).join("");
assert(output.products.every((card) => recalled.includes(card.productId)), "Every exact product ID must survive the next chat turn.");
assert(recalled.includes((total / 100).toFixed(2)), "The exact pieces subtotal must survive the next chat turn.");
console.log("PASS follow-up chat recalls the same five exact catalog IDs and subtotal without another lookup, styling call, or cart action.");
