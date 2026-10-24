import { beforeAll, describe, expect, test } from "bun:test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

// lib/catalog.ts imports "server-only", which only Next resolves; stub it for bun.
type BunLike = { plugin(p: { name: string; setup(b: { module(n: string, f: () => unknown): void }): void }): void };
(globalThis as unknown as { Bun: BunLike }).Bun.plugin({
  name: "server-only-stub",
  setup(build) {
    build.module("server-only", () => ({ exports: {}, loader: "object" }));
  },
});

const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

let runChat: typeof import("../chat").runChat;
let buildSystemPrompt: typeof import("../prompt").buildSystemPrompt;
let getCostume: typeof import("../../catalog").getCostume;
beforeAll(async () => {
  ({ runChat } = await import("../chat"));
  ({ buildSystemPrompt } = await import("../prompt"));
  ({ getCostume } = await import("../../catalog"));
});

const SLUG = "cosmic-cowboy";
const userMsg = (text: string) => ({ id: "u1", role: "user" as const, parts: [{ type: "text" as const, text }] });

describe("assistant chat config", () => {
  test("server tool executes against the catalog; client tool is streamed without a result", async () => {
    const view = await getCostume(SLUG);
    expect(view).not.toBeNull();
    if (!view!.pieces[0].options.length) {
      console.warn("skipped: catalog has no matches (set FALKORDB_URL to a seeded graph)");
      return;
    }
    const pieceId = view!.pieces[0].piece.id;

    const prompts: unknown[] = [];
    let call = 0;
    const model = new MockLanguageModelV4({
      doStream: async (options) => {
        prompts.push(options.prompt);
        call++;
        const chunks =
          call === 1
            ? [
                { type: "tool-call", toolCallId: "c1", toolName: "findAlternatives", input: JSON.stringify({ pieceId, localOnly: false }) },
                { type: "tool-call", toolCallId: "c2", toolName: "recordSizes", input: JSON.stringify({ sizes: [{ pieceId, size: "M" }] }) },
                { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, logprobs: undefined, usage },
              ]
            : [
                { type: "text-start", id: "t1" },
                { type: "text-delta", id: "t1", delta: "Done." },
                { type: "text-end", id: "t1" },
                { type: "finish", finishReason: { unified: "stop", raw: undefined }, logprobs: undefined, usage },
              ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { stream: simulateReadableStream({ chunks: chunks as any }) };
      },
    });

    const result = await runChat(
      { messages: [userMsg("I'm a medium, anything cheaper?")], costumeSlug: SLUG, cart: [{ pieceId, productId: view!.pieces[0].options[0].product.id, size: null }] },
      model,
    );
    expect(result).not.toBeNull();

    const chunks: Array<Record<string, unknown>> = [];
    const reader = result!.toUIMessageStream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as Record<string, unknown>);
    }

    // Server tool ran and produced catalog data.
    const found = chunks.find((c) => c.type === "tool-output-available" && c.toolCallId === "c1") as { output: { count: number; options: Array<{ productId: string; pieceId: string }> } } | undefined;
    expect(found !== undefined).toBe(true);
    expect(found!.output.count).toBeGreaterThan(0);
    expect(found!.output.options.every((o) => o.pieceId === pieceId)).toBe(true);

    // Client tool call reached the stream as input-available with no output.
    expect(chunks.some((c) => c.type === "tool-input-available" && c.toolName === "recordSizes" && c.toolCallId === "c2")).toBe(true);
    expect(chunks.some((c) => c.type === "tool-output-available" && c.toolCallId === "c2")).toBe(false);

    // The system prompt carried the cart state into the model call.
    expect(JSON.stringify(prompts[0])).toContain("SIZE MISSING");
  });

  test("a tool-result continuation reuses the assistant message id", async () => {
    const view = await getCostume(SLUG);
    if (!view!.pieces[0].options.length) return;
    const pieceId = view!.pieces[0].piece.id;
    const messages = [
      userMsg("I'm a medium"),
      {
        id: "a1",
        role: "assistant" as const,
        parts: [
          {
            type: "tool-recordSizes" as const,
            toolCallId: "c2",
            state: "output-available" as const,
            input: { sizes: [{ pieceId, size: "M" }] },
            output: { applied: [{ pieceId, size: "M" }], notInCartYet: [], unknownPieces: [] },
          },
        ],
      },
    ];
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({ chunks: [
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "Saved." },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: undefined }, logprobs: undefined, usage },
        ] as never }),
      }),
    });
    const result = await runChat({ messages, costumeSlug: SLUG, cart: [] }, model);
    const reader = result!.toUIMessageStream({ originalMessages: messages as never }).getReader();
    const chunks: Array<Record<string, unknown>> = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as Record<string, unknown>);
    }
    expect(chunks.find((c) => c.type === "start")?.messageId).toBe("a1");
  });

  test("unknown costume returns null", async () => {
    expect(await runChat({ messages: [userMsg("hi")], costumeSlug: "nope", cart: [] })).toBeNull();
  });

  test("prompt lists missing sizes and uncarted pieces", async () => {
    const view = (await getCostume(SLUG))!;
    const p = buildSystemPrompt(view, []);
    expect(p).toContain("(empty)");
    expect(p).toContain("Not in the cart yet");
  });
});
