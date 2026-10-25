import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getCostume } from "../catalog/queries";
import type { CostumeSnapshot } from "../types";
import { createOutfit, applyActions } from "./state";
import { commandFromAnswers, outfitQuestions } from "./voice-decisions";

const snapshot = JSON.parse(readFileSync(new URL("../../data/costumes/cosmic-cowboy.json", import.meta.url), "utf8")) as CostumeSnapshot;
const costume = (await getCostume([snapshot], "cosmic-cowboy"))!;
const outfit = createOutfit(costume);
const first = costume.pieces[0];
const alternative = first.options.find(option => option.product.id !== outfit.selection[first.piece.id])!;
const choice = (name: string, value: string) => ({ type: "choice", name, choice: value, confidence: 1 });

describe("native voice decisions", () => {
  it("cannot replace a kept piece unless the same request unlocks it", () => {
    const kept = { ...outfit, locked: [first.piece.id] };
    assert.deepEqual(commandFromAnswers([choice("piece_0", alternative.product.id)], costume, kept).actions, []);
    const command = commandFromAnswers([choice("piece_0", alternative.product.id), choice("lock_0", "unlock")], costume, kept);
    const applied = applyActions(costume, kept, command.actions);
    assert.equal(applied.outfit.selection[first.piece.id], alternative.product.id);
    assert.deepEqual(applied.outfit.locked, []);
  });
  it("rejects invented products and a required-piece skip", () => {
    assert.deepEqual(commandFromAnswers([choice("piece_0", "invented-product")], costume, outfit).actions, []);
    assert.deepEqual(commandFromAnswers([choice("piece_0", "skip")], costume, outfit).actions, []);
  });
  it("applies a piece change while preserving unrelated kept pieces", () => {
    const jacket = costume.pieces[1];
    const newJacket = jacket.options.find(option => option.product.id !== outfit.selection[jacket.piece.id])!;
    const command = commandFromAnswers([choice("lock_0", "lock"), choice("piece_1", newJacket.product.id)], costume, outfit);
    const next = applyActions(costume, outfit, command.actions).outfit;
    assert.equal(next.selection[first.piece.id], outfit.selection[first.piece.id]);
    assert.equal(next.selection[jacket.piece.id], newJacket.product.id);
    assert.deepEqual(next.locked, [first.piece.id]);
  });
  it("does not repeat a selection already applied", () => {
    assert.deepEqual(commandFromAnswers([choice("piece_0", outfit.selection[first.piece.id])], costume, outfit).actions, []);
  });
  it("makes undo atomic rather than combining it with a newer selection", () => {
    assert.deepEqual(commandFromAnswers([choice("piece_0", alternative.product.id), choice("action", "undo")], costume, outfit).actions, [{ type: "undo" }]);
  });
  it("ignores refusals rather than reading a fabricated choice", () => {
    assert.deepEqual(commandFromAnswers([{ type: "refusal", name: "piece_0", choice: alternative.product.id }], costume, outfit).actions, []);
  });
  it("preserves option positions when a preceding option sells out", () => {
    const changed = structuredClone(costume);
    changed.pieces[0].options[0].product.availability = "out_of_stock";
    const question = outfitQuestions(changed).find(item => item.name === "piece_0")!;
    assert.equal(question.choices.some(item => item.value === first.options[0].product.id), false);
    assert.match(question.choices.find(item => item.value === first.options[1].product.id)!.description!, /^Option 2:/);
  });
});
