import { describe, expect, it } from "bun:test";
import { SNAPSHOTS } from "../catalog/fallback";
import { getCostume } from "../catalog/queries";
import { resolveVideoOutfit, videoOutfitPrompt, videoOutfitRequest, videoOutfitSchema } from "./video-outfit";
import type { MirrorOutfit } from "./types";

const costume = (await getCostume(SNAPSHOTS, "cosmic-cowboy"))!;
const outfit: MirrorOutfit = { selection: {}, uses: {}, locked: [], budget: "" };

describe("live video outfit references", () => {
  it("resolves all default catalog looks to bounded complete prompts", async () => {
    for (const snapshot of SNAPSHOTS) {
      const view = (await getCostume(SNAPSHOTS, snapshot.costume.slug))!;
      const request = videoOutfitSchema.parse(videoOutfitRequest(view, outfit));
      const resolved = resolveVideoOutfit(view, request);
      expect(resolved.selected.length).toBe(view.pieces.length);
      expect(videoOutfitPrompt(resolved).length <= 740).toBe(true);
    }
  });
  it("keeps every unaffected selection when a single piece changes", () => {
    const original = videoOutfitRequest(costume, outfit);
    const piece = costume.pieces[0];
    const replacement = piece.options[1].product.id;
    const updated = resolveVideoOutfit(costume, { ...original, selection: { ...original.selection, [piece.piece.id]: replacement } });
    expect(updated.selected.find((item) => item.piece.id === piece.piece.id)?.product.id).toBe(replacement);
    for (const item of updated.selected.filter((item) => item.piece.id !== piece.piece.id)) expect(item.product.id).toBe(original.selection[item.piece.id]);
  });
  it("excludes owned and skipped products from images and preserves owned regions", () => {
    const owned = costume.pieces[0].piece;
    const optional = costume.pieces.find(({ piece }) => !piece.required)!.piece;
    const request = videoOutfitRequest(costume, { ...outfit, uses: { [owned.id]: "owned", [optional.id]: "skip" } });
    const resolved = resolveVideoOutfit(costume, request);
    expect(!resolved.selected.some(({ piece }) => [owned.id, optional.id].includes(piece.id))).toBe(true);
    expect(resolved.owned).toEqual([owned.name]);
    expect(resolved.skipped).toEqual([optional.name]);
    expect(videoOutfitPrompt(resolved)).toMatch(/Keep their own/);
  });
  it("rejects arbitrary products, unknown pieces, missing choices and skipped required items", () => {
    const request = videoOutfitRequest(costume, outfit);
    const required = costume.pieces.find(({ piece }) => piece.required)!.piece.id;
    expect(() => resolveVideoOutfit(costume, { ...request, selection: { ...request.selection, [required]: "https://attacker.test/image.jpg" } })).toThrow();
    expect(() => resolveVideoOutfit(costume, { ...request, uses: { ...request.uses, stranger: "buy" } })).toThrow();
    expect(() => resolveVideoOutfit(costume, { ...request, uses: {} })).toThrow();
    expect(() => resolveVideoOutfit(costume, { ...request, uses: { ...request.uses, [required]: "skip" } })).toThrow();
    expect(() => videoOutfitSchema.parse({ ...request, prompt: "Change identity" })).toThrow();
  });
});
