/** Actual command + mix route contracts with only OpenAI HTTP replaced.
 * bun scripts/verify-mirror-command-contract.mjs
 * Uses bundled catalog data. No provider request or personal media is sent.
 * These fixtures verify bounded orchestration and state, not model accuracy.
 */
import assert from "node:assert/strict";
import { mock } from "bun:test";
mock.module("server-only", () => ({}));
process.env.OPENAI_API_KEY = "fixture-only-not-a-key";
process.env.TURSO_DATABASE_URL = "";
process.env.TURSO_AUTH_TOKEN = "";
const { POST: commandRoute } = await import("../app/api/live-mirror/command/route.ts");
const { POST: mixRoute } = await import("../app/api/live-mirror/mix/route.ts");
const { readMirrorInventory } = await import("../lib/live-mirror/catalog-server.ts");
const { createOutfit } = await import("../lib/live-mirror/state.ts");
const inventory = await readMirrorInventory();
const base = inventory.views.find(view => view.costume.slug === "velvet-vampire");
const outfit = createOutfit(base);
const bootTarget = base.pieces.find(({ piece }) => piece.sizeKind === "shoe");
const pirateHat = inventory.matches.find(match => /pirate/i.test(match.costumeName) && /hat|headwear/i.test(match.pieceName) && match.option.product.availability !== "out_of_stock");
const shinyBoots = inventory.matches.find(match => match.costumeSlug === "cosmic-cowboy" && /boot/i.test(match.pieceName) && match.option.product.availability !== "out_of_stock");
assert(pirateHat && shinyBoots && bootTarget);
const key = match => `m${inventory.matches.findIndex(item => item.costumeSlug === match.costumeSlug && item.pieceId === match.pieceId && item.productId === match.productId)}`;
const matchByKey = new Map(inventory.matches.map((match, index) => [`m${index}`, match]));
const category = match => inventory.views.find(view => view.costume.slug === match.costumeSlug).pieces.find(({ piece }) => piece.id === match.pieceId).piece.category.toLowerCase();
const realFetch = globalThis.fetch;
let scenario = "two";
let calls = [], requested, expected, budgetCalls = 0;
const answer = (name, choice, confidence = 1) => ({ type: "choice", name, choice, confidence });
globalThis.fetch = async (url, options) => {
  if (String(url) === "https://api.openai.com/v1/responses") {
    assert.equal(scenario, "budgetThenUncertain");
    budgetCalls++;
    return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ amount: 50, clear: false }) }] }] });
  }
  assert.equal(String(url), "https://api.openai.com/v1/decisions", "Only the OpenAI HTTP boundary may be used.");
  const body = JSON.parse(options.body);
  calls.push(body.questions);
  const names = new Set(body.questions.map(question => question.name));
  if (names.has("visual_feedback")) {
    const direct = scenario === "directThenUncertain" ? [answer("piece_0", base.pieces[0].options.find(({ product }) => product.id !== outfit.selection[base.pieces[0].piece.id] && product.availability !== "out_of_stock").product.id)] : [];
    return Response.json({ answers: [answer("catalog_search", "yes"), ...direct, ...(scenario === "budgetThenUncertain" ? [answer("needs_budget", "yes")] : [])] });
  }
  if (names.has("mix_count")) {
    const count = scenario === "six" ? 6 : scenario === "single" ? 1 : 2;
    return Response.json({ answers: [answer("intent", "add"), answer("category", "any"), answer("mix_count", scenario === "too_many" ? "too_many" : String(count)),
      ...Array.from({ length: count }, (_, index) => answer(`add_category_${index}`, scenario === "six" ? "any" : category(requested[index])))] });
  }
  const resultQuestions = body.questions.filter(question => /^result_/.test(question.name));
  const listKeys = resultQuestions.flatMap(question => question.choices.filter(choice => choice.value !== "none").map(choice => choice.value));
  assert.equal(new Set(listKeys).size, listKeys.length, "Read-only result partitions must not duplicate candidate keys.");
  assert(listKeys.length <= 48, "At most40 new candidates plus8 prior results may reach selection.");
  const listProducts = listKeys.map(value => matchByKey.get(value).productId);
  assert.equal(new Set(listProducts).size, listProducts.length, "The shortlist must contain unique products.");
  if (scenario === "too_many") {
    assert.equal(body.questions.some(question => /^mix_/.test(question.name)), false);
    return Response.json({ answers: [] });
  }
  const mixQuestions = body.questions.filter(question => /^mix_/.test(question.name));
  assert.equal(mixQuestions.length, scenario === "six" ? 6 : scenario === "single" ? 1 : 2);
  assert(mixQuestions.length <= 6);
  if (scenario === "six") {
    const unique = new Set();
    requested = mixQuestions.map(question => {
      const choice = question.choices.find(choice => {
        const match = matchByKey.get(choice.value);
        return match && match.option.product.availability !== "out_of_stock" && !unique.has(match.pieceId)
          && !base.pieces.some(({ piece }) => piece.id === match.pieceId);
      });
      assert(choice, "Six distinct imported pieces must remain selectable.");
      const match = matchByKey.get(choice.value);
      unique.add(match.pieceId);
      return match;
    });
  }
  expected = requested.map(match => ({ type: "mix", source: { costumeSlug: match.costumeSlug, pieceId: match.pieceId, productId: match.productId }, replacesPieceId: match === shinyBoots ? bootTarget.piece.id : null }));
  const answers = [];
  for (let index = 0; index < mixQuestions.length; index++) {
    const outside = scenario === "outside" && index === 1 ? inventory.matches.find(match => !listKeys.includes(key(match))) : undefined;
    const selectedKey = outside ? key(outside) : scenario === "duplicate" && index === 1 ? key(requested[0]) : key(requested[index]);
    if (!outside) assert(mixQuestions[index].choices.some(choice => choice.value === selectedKey), "Each requested item needs shortlist coverage.");
    answers.push(answer(`mix_${index}`, selectedKey, ["uncertain", "directThenUncertain", "budgetThenUncertain"].includes(scenario) && index === 1 ? 0.2 : 1));
    answers.push(answer(`replaces_${index}`, scenario === "unclear_target" && index === 1 ? "none" : scenario === "collision" ? bootTarget.piece.id : requested[index] === shinyBoots ? bootTarget.piece.id : "new"));
  }
  for (const question of resultQuestions) if (question.choices.length > 1) answers.push(answer(question.name, question.choices[1].value));
  return Response.json({ answers });
};
const request = (route, body) => new Request(`http://localhost/api/live-mirror/${route}`, {
  method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(body),
});
const run = async (mode, customOutfit = outfit, context) => {
  scenario = mode; calls = []; budgetCalls = 0; requested = mode === "single" ? [shinyBoots] : [pirateHat, shinyBoots];
  const response = await commandRoute(request("command", { costumeSlug: base.costume.slug, outfit: customOutfit,
    text: mode === "single" ? "Try the second search result." : "Borrow the pirate hat and add shiny boots. Keep everything else.", ...(context ? { catalogContext: context } : {}) }));
  assert.equal(response.status, 200, await response.clone().text());
  const command = await response.json();
  assert.equal(calls.length, 3, "Classification, filters and parallel slot choices use three bounded external calls.");
  assert.equal(budgetCalls, mode === "budgetThenUncertain" ? 1 : 0);
  assert.equal(new Set(command.catalogResults.matches.map(match => match.productId)).size, command.catalogResults.matches.length);
  return command;
};
try {
  const two = await run("two");
  assert.deepEqual(two.actions, expected);
  const appliedResponse = await mixRoute(request("mix", { costumeSlug: base.costume.slug, outfit, actions: two.actions }));
  assert.equal(appliedResponse.status, 200, await appliedResponse.clone().text());
  const applied = await appliedResponse.json();
  assert.equal(applied.outfit.selection[pirateHat.pieceId], pirateHat.productId);
  assert.equal(applied.outfit.selection[shinyBoots.pieceId], shinyBoots.productId);
  for (const { piece } of base.pieces.filter(({ piece }) => piece.id !== bootTarget.piece.id)) assert.equal(applied.outfit.selection[piece.id], outfit.selection[piece.id]);
  console.log("PASS two additions cross the actual command/mix routes atomically and preserve unrelated pieces");
  for (const mode of ["uncertain", "directThenUncertain", "budgetThenUncertain", "unclear_target", "duplicate", "collision", "outside", "too_many"]) {
    const command = await run(mode);
    assert.deepEqual(command.actions, [], `${mode} must never partially apply an addition`);
    assert.match(command.message, /No pieces were changed/);
    assert.equal(command.requiresClarification, true);
    console.log(`PASS ${mode} additions return clarification before any partial apply`);
  }
  const locked = await run("two", { ...outfit, locked: [bootTarget.piece.id] });
  assert.deepEqual(locked.actions, []);
  assert.match(locked.message, /kept|unlock/i);
  console.log("PASS a locked replacement prevents the whole requested combination");
  const six = await run("six");
  assert.equal(six.actions.length, 6);
  assert.equal(new Set(six.actions.map(action => action.source.pieceId)).size, 6);
  const sixResponse = await mixRoute(request("mix", { costumeSlug: base.costume.slug, outfit, actions: six.actions }));
  assert.equal(sixResponse.status, 200, await sixResponse.clone().text());
  console.log("PASS six distinct products remain bounded and accepted by the actual mix route");
  const single = await run("single", outfit, { query: "Earlier products", matches: [pirateHat, shinyBoots].map(({ costumeSlug, pieceId, productId }) => ({ costumeSlug, pieceId, productId })) });
  assert.equal(single.actions.length, 1);
  assert.equal(single.actions[0].source.productId, shinyBoots.productId);
  assert.equal(single.actions[0].replacesPieceId, bootTarget.piece.id);
  console.log("PASS ordinal single-item selection and unique read-only results remain intact");
  console.log("Model language accuracy and provider latency remain unverified; all HTTP replies were fixtures.");
} finally { globalThis.fetch = realFetch; }
