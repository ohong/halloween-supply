"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { PromptInput, PromptInputSubmit, PromptInputTextarea } from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Button } from "@/components/ui/button";
import { pieceSizesSchema, sizesSchema, type ChatContext } from "@/lib/ai/chat-context";
import type { ProductCard } from "@/lib/ai/cards";
import { addToCartSchema, recordSizesSchema, type RecordSizesInput } from "@/lib/ai/client-tools";
import { pieceSizesStorageKey, sizesStorageKey, useCart } from "@/lib/cart/context";
import { compatibleSize, toCartItem } from "@/lib/cart/item";
import type { CostumeView, SizeKind } from "@/lib/types";
import { MessageView } from "./message-view";

type Sizes = Partial<Record<SizeKind, string>>;
type ToolReceipt = { tool: "recordSizes" | "addToCart"; input: string; output?: unknown; error?: string };
const starters = ["What sizes do you need from me?", "Anything cheaper?", "Only shops in the Bay Area, please"];

function readSizes(): Sizes {
  try {
    const parsed = sizesSchema.safeParse(JSON.parse(localStorage.getItem(sizesStorageKey) ?? "{}"));
    return parsed.success ? parsed.data : {};
  } catch { return {}; }
}

function readPieceSizes(): Record<string, string> {
  try {
    const parsed = pieceSizesSchema.safeParse(JSON.parse(localStorage.getItem(pieceSizesStorageKey) ?? "{}"));
    return parsed.success ? parsed.data : {};
  } catch { return {}; }
}

function errorMessage(error: Error): string {
  try {
    const parsed: unknown = JSON.parse(error.message);
    if (parsed && typeof parsed === "object" && typeof (parsed as { error?: unknown }).error === "string") return (parsed as { error: string }).error;
  } catch { /* The stream also returns plain messages. */ }
  return error.message || "The assistant could not answer.";
}

export function AssistantPanel({ costume, onChoose }: { costume: CostumeView; onChoose?: (pieceId: string, productId: string) => void }) {
  const cart = useCart();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sizes, setSizes] = useState<Sizes>({});
  const [pieceSizes, setPieceSizes] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const receipts = useRef(new Map<string, ToolReceipt>());
  const cartRef = useRef(cart);
  const sizesRef = useRef<Sizes>({});
  const pieceSizesRef = useRef<Record<string, string>>({});
  const costumeRef = useRef(costume);
  const onChooseRef = useRef(onChoose);
  useEffect(() => {
    cartRef.current = cart;
    costumeRef.current = costume;
    onChooseRef.current = onChoose;
  });

  useEffect(() => {
    const stored = readSizes();
    const storedPieces = readPieceSizes();
    sizesRef.current = stored;
    pieceSizesRef.current = storedPieces;
    // Browser storage and a cart link cannot be read during server rendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSizes(stored);
    setPieceSizes(storedPieces);
    if (new URLSearchParams(window.location.search).get("assistant") === "sizes") setOpen(true);
    const show = () => setOpen(true);
    window.addEventListener("halloween:open-assistant", show);
    return () => window.removeEventListener("halloween:open-assistant", show);
  }, []);

  const context: ChatContext = {
    costumeSlug: costume.costume.slug,
    cart: cart.costumeSlug === costume.costume.slug
      ? cart.items.map((item) => ({ pieceId: item.pieceId, productId: item.productId, size: item.size })) : [],
    sizes,
    pieceSizes: Object.fromEntries(costume.pieces.flatMap(({ piece }) => pieceSizes[piece.id] && piece.sizeKind !== "one_size" ? [[piece.id, pieceSizes[piece.id]]] : [])),
  };
  const contextRef = useRef(context);
  useEffect(() => { contextRef.current = context; });

  const addProduct = useCallback((pieceId: string, productId: string) => {
    const piece = costumeRef.current.pieces.find(({ piece }) => piece.id === pieceId);
    const option = piece?.options.find(({ product }) => product.id === productId);
    if (!piece || !option || option.product.availability === "out_of_stock") throw new Error("That product is not available for this piece.");
    const item = toCartItem(piece.piece, option, pieceSizesRef.current[pieceId] ?? sizesRef.current[piece.piece.sizeKind] ?? null);
    const size = item.size;
    cartRef.current.add(item, costumeRef.current.costume.slug);
    contextRef.current = {
      ...contextRef.current,
      cart: [...contextRef.current.cart.filter((line) => line.pieceId !== pieceId), { pieceId, productId, size }],
    };
    onChooseRef.current?.(pieceId, productId);
    return { ok: true, title: option.product.title, pieceId, productId, size };
  }, []);

  const recordSizes = useCallback(({ sizes: entries }: RecordSizesInput) => {
    const activePieces = costumeRef.current.pieces.map(({ piece }) => piece);
    if (entries.some((entry) => entry.pieceId !== undefined && !activePieces.some((piece) => piece.id === entry.pieceId && piece.sizeKind === entry.sizeKind))) throw new Error("That size does not belong to this costume.");
    const next = { ...sizesRef.current };
    const nextPieces = { ...pieceSizesRef.current };
    const updated = new Set<string>();
    const unmatched: { pieceId: string; requested: string; availableSizes: string[] }[] = [];
    // Apply general preferences first so explicit piece choices win in the same call.
    for (const { sizeKind, size } of entries.filter((entry) => entry.pieceId === undefined)) {
      next[sizeKind] = size;
      for (const piece of activePieces.filter((piece) => piece.sizeKind === sizeKind)) delete nextPieces[piece.id];
    }
    for (const { pieceId, size } of entries) if (pieceId !== undefined) nextPieces[pieceId] = size;
    const affected = new Set(activePieces.filter((piece) => entries.some((entry) => entry.pieceId === piece.id || entry.pieceId === undefined && entry.sizeKind === piece.sizeKind)).map((piece) => piece.id));
    sizesRef.current = next;
    pieceSizesRef.current = nextPieces;
    contextRef.current = {
      ...contextRef.current,
      sizes: next,
      pieceSizes: Object.fromEntries(activePieces.flatMap((piece) => nextPieces[piece.id] ? [[piece.id, nextPieces[piece.id]]] : [])),
      cart: contextRef.current.cart.map((line) => {
        const piece = activePieces.find((piece) => piece.id === line.pieceId);
        const requested = piece && affected.has(piece.id) ? nextPieces[piece.id] ?? next[piece.sizeKind] : undefined;
        if (!piece || !requested) return line;
        const option = costumeRef.current.pieces.find(({ piece: candidate }) => candidate.id === line.pieceId)?.options.find(({ product }) => product.id === line.productId);
        const size = compatibleSize({ sizeKind: piece.sizeKind, availableSizes: option?.product.sizes ?? [] }, requested);
        cartRef.current.setSize(line.pieceId, size);
        if (size || piece.sizeKind === "one_size") updated.add(line.pieceId);
        else unmatched.push({ pieceId: line.pieceId, requested, availableSizes: option?.product.sizes ?? [] });
        return { ...line, size };
      }),
    };
    setSizes(next);
    setPieceSizes(nextPieces);
    try {
      localStorage.setItem(sizesStorageKey, JSON.stringify(next));
      localStorage.setItem(pieceSizesStorageKey, JSON.stringify(nextPieces));
    }
    catch { /* Sizes remain in the current conversation if storage is blocked. */ }
    // Unmatched pieces stay unsized so the model can ask the shopper or retry with an exact label.
    return { saved: entries, updatedPieceIds: [...updated], unmatched };
  }, []);

  const [transport] = useState(
    // eslint-disable-next-line react-hooks/refs -- this callback runs only when a request is sent
    () => new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages }) => ({ body: { messages, context: contextRef.current } }),
    }),
  );

  const { messages, sendMessage, addToolOutput, status, error, clearError, regenerate, stop } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall({ toolCall }) {
      if (toolCall.dynamic || (toolCall.toolName !== "recordSizes" && toolCall.toolName !== "addToCart")) return;
      const tool = toolCall.toolName;
      const serialized = JSON.stringify(toolCall.input);
      let receipt = receipts.current.get(toolCall.toolCallId);
      if (receipt && (receipt.tool !== tool || receipt.input !== serialized)) {
        addToolOutput({ tool, toolCallId: toolCall.toolCallId, state: "output-error", errorText: "This cart action was already used." });
        return;
      }
      if (!receipt) {
        receipt = { tool, input: serialized };
        // Mark before applying: repeated stream events must never repeat a cart mutation.
        receipts.current.set(toolCall.toolCallId, receipt);
        try {
          receipt.output = tool === "recordSizes" ? recordSizes(recordSizesSchema.parse(toolCall.input)) : (() => {
            const { pieceId, productId } = addToCartSchema.parse(toolCall.input);
            return addProduct(pieceId, productId);
          })();
        } catch {
          receipt.error = "Could not apply that cart action. Please try again.";
        }
      }
      // Awaiting addToolOutput inside onToolCall can deadlock the stream.
      if (receipt.error) addToolOutput({ tool, toolCallId: toolCall.toolCallId, state: "output-error", errorText: receipt.error });
      else addToolOutput({ tool, toolCallId: toolCall.toolCallId, output: receipt.output });
    },
  });
  const busy = status === "submitted" || status === "streaming";

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key !== "Tab") return;
      const controls = panel?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), [tabindex='0']");
      const first = controls?.[0];
      const last = controls?.[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    clearError();
    void sendMessage({ text: trimmed });
    setInput("");
  };
  const onSubmit = (event: FormEvent) => { event.preventDefault(); send(input); };
  const cartProductIds = useMemo(() => new Set(cart.items.map((item) => item.productId)), [cart.items]);
  const onAdd = useCallback((card: ProductCard) => { addProduct(card.pieceId, card.productId); }, [addProduct]);
  const pieceNames = Object.fromEntries(costume.pieces.map(({ piece }) => [piece.id, piece.name]));
  const savedLabels = costume.pieces.flatMap(({ piece }) => {
    const size = pieceSizes[piece.id] ?? sizes[piece.sizeKind];
    return size && piece.sizeKind !== "one_size" ? [`${piece.name}: ${size}`] : [];
  });

  return <>
    {!open && <Button ref={triggerRef} onClick={() => setOpen(true)} aria-label="Talk to your personal shopper" aria-expanded={open} aria-controls="shopping-assistant" className="assistant-trigger fixed z-40">Help</Button>}
    {open && <>
    <div className="ai-scrim fixed inset-0 z-40" onClick={close} aria-hidden="true" />
    <section ref={panelRef} id="shopping-assistant" role="dialog" aria-modal="true" aria-labelledby="shopping-assistant-title" className="ai-panel fixed inset-x-0 bottom-0 z-50 flex h-[85dvh] flex-col md:inset-x-auto md:right-4 md:bottom-4 md:h-[min(680px,calc(100dvh-32px))] md:w-[400px]">
      <header className="ai-panel-head">
        <div className="min-w-0">
          <h2 id="shopping-assistant-title" className="text-[15px] font-normal text-[#111]">Your personal shopper</h2>
          <p className="truncate text-xs text-[#666]">{costume.costume.name}</p>
        </div>
        <button type="button" onClick={close} aria-label="Close your personal shopper" className="ai-icon-button"><XIcon className="size-4" aria-hidden /></button>
      </header>
      {savedLabels.length > 0 && <p className="assistant-sizes" aria-live="polite"><span className="text-[#111]">Sizes</span> {savedLabels.join(" · ")}</p>}
      <Conversation aria-label="Conversation with your personal shopper">
        <ConversationContent>
          {messages.length === 0 && <div className="ai-message flex flex-col items-start gap-2 pt-2">
            <p className="text-[15px] leading-relaxed text-[#111]">Hi, I can find swaps for the {costume.costume.name} pieces, save your sizes and add picks to your cart.</p>
            <p className="text-[13px] leading-relaxed text-[#666]">Share your top, pants, shoe and hat sizes. I&apos;ll ask only for what this look needs.</p>
          </div>}
          {messages.map((message) => <MessageView key={message.id} message={message} cartProductIds={cartProductIds} pieceNames={pieceNames} onAdd={onAdd} />)}
          {status === "submitted" && <p role="status" className="ai-message text-[13px]"><Shimmer>Checking the catalog…</Shimmer></p>}
          {error && <div role="alert" className="ai-message ai-error">
            <p>{errorMessage(error)}</p>
            <button type="button" className="ai-suggestion" onClick={() => { clearError(); void regenerate(); }}>Try again</button>
          </div>}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <div className="assistant-form shrink-0">
        {messages.length === 0 && <Suggestions aria-label="Suggested questions">{starters.map((starter) => <Suggestion key={starter} suggestion={starter} onClick={send} />)}</Suggestions>}
        <PromptInput onSubmit={onSubmit}>
          <PromptInputTextarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} maxLength={6000} autoComplete="off" enterKeyHint="send" placeholder="Ask about a piece or share your sizes" aria-label="Message your personal shopper" />
          <PromptInputSubmit busy={busy} onStop={() => { void stop(); }} disabled={!input.trim()} />
        </PromptInput>
      </div>
    </section></>}
  </>;
}
