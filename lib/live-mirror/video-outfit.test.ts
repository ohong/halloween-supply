import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
      assert.equal(resolved.selected.length, view.pieces.length);
      assert.ok(videoOutfitPrompt(resolved).length <= 740);
    }
  });
  it("keeps every unaffected selection when a single piece changes", () => {
    const original = videoOutfitRequest(costume, outfit);
    const piece = costume.pieces[0];
    const replacement = piece.options[1].product.id;
    const updated = resolveVideoOutfit(costume, { ...original, selection: { ...original.selection, [piece.piece.id]: replacement } });
    assert.equal(updated.selected.find((item) => item.piece.id === piece.piece.id)?.product.id, replacement);
    for (const item of updated.selected.filter((item) => item.piece.id !== piece.piece.id)) assert.equal(item.product.id, original.selection[item.piece.id]);
  });
  it("excludes owned and skipped products from images and preserves owned regions", () => {
    const owned = costume.pieces[0].piece;
    const optional = costume.pieces.find(({ piece }) => !piece.required)!.piece;
    const request = videoOutfitRequest(costume, { ...outfit, uses: { [owned.id]: "owned", [optional.id]: "skip" } });
    const resolved = resolveVideoOutfit(costume, request);
    assert.ok(!resolved.selected.some(({ piece }) => [owned.id, optional.id].includes(piece.id)));
    assert.deepEqual(resolved.owned, [owned.name]);
    assert.deepEqual(resolved.skipped, [optional.name]);
    assert.match(videoOutfitPrompt(resolved), /Keep the camera clothing for owned pieces/);
  });
  it("rejects arbitrary products, unknown pieces, missing choices and skipped required items", () => {
    const request = videoOutfitRequest(costume, outfit);
    const required = costume.pieces.find(({ piece }) => piece.required)!.piece.id;
    assert.throws(() => resolveVideoOutfit(costume, { ...request, selection: { ...request.selection, [required]: "https://attacker.test/image.jpg" } }));
    assert.throws(() => resolveVideoOutfit(costume, { ...request, uses: { ...request.uses, stranger: "buy" } }));
    assert.throws(() => resolveVideoOutfit(costume, { ...request, uses: {} }));
    assert.throws(() => resolveVideoOutfit(costume, { ...request, uses: { ...request.uses, [required]: "skip" } }));
    assert.throws(() => videoOutfitSchema.parse({ ...request, prompt: "Change identity" }));
  });
});
