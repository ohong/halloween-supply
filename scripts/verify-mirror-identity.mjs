// Real local route checks; no camera access or paid inference.
import assert from "node:assert/strict";

const origin = new URL(process.env.MIRROR_BASE_URL ?? "http://localhost:3028").origin;
const get = async url => {
  const response = await fetch(`${origin}${url}`);
  assert.equal(response.status, 200);
  return response.json();
};
const { looks } = await get("/api/live-mirror/catalog");
assert.equal((await get("/api/live-mirror/video")).model, "decart/lucy2-vton/realtime");
let checked = 0;
async function verify(input) {
  const response = await fetch(`${origin}/api/live-mirror/reference`, {
    method: "POST", headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.image, null, "Merchant model faces must never reach Lucy");
  assert(result.prompt.startsWith("Change clothing only."));
  assert(result.prompt.includes("exact face and likeness"));
  assert(result.prompt.endsWith("Identity preservation overrides every clothing edit."));
  assert(result.prompt.length <= 740);
  checked++;
  return result;
}
for (const look of looks) {
  const view = await get(`/api/live-mirror/catalog?slug=${encodeURIComponent(look.slug)}`);
  for (let tier = 0; tier < 3; tier++) {
    const input = {
      costumeSlug: look.slug,
      selection: Object.fromEntries(view.pieces.map(({ piece, options }) => [piece.id, (options.filter(({ product }) => product.availability !== "out_of_stock")[tier] ?? options.find(({ product }) => product.availability !== "out_of_stock")).product.id])),
      uses: Object.fromEntries(view.pieces.map(({ piece }) => [piece.id, "buy"])),
    };
    await verify(input);
    if (look.slug === "pumpkin-harlequin" && tier === 0) {
      const hat = view.pieces.find(({ piece }) => piece.category === "headwear").piece.id;
      const edited = await verify({ ...input, appearance: { [hat]: { color: "blue" } } });
      assert(edited.prompt.includes("blue"));
      const owned = await verify({ ...input, uses: { ...input.uses, [hat]: "owned" } });
      assert(owned.prompt.includes("Keep the camera clothing for owned pieces"));
    }
  }
}
console.log(`PASS ${checked} real reference requests across ${looks.length} looks: no merchant images; identity instructions retained through product, color and owned-piece changes.`);
console.log("Generated face fidelity remains unverified; these checks do not call Lucy.");
