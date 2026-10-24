// One Shopping SERP call: answers the brief's open question
// "does a Shopping-type query return a populated `shopping` array with prices?"
//   bun scripts/source/serp-probe.ts ["query"] [--tbm]
import { parseSerpPayload, serpRaw, buildSerpUrl } from "../../lib/brightdata/client";

async function main() {
  const args = process.argv.slice(2);
  const tbm = args.includes("--tbm");
  const query = args.find((a) => !a.startsWith("--")) ?? "silver cowboy hat";
  const missing = ["BRIGHTDATA_API_KEY", "BRIGHTDATA_SERP_ZONE"].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing ${missing.join(", ")}. Set them in .env.local.`);
    process.exit(1);
  }
  const mode = tbm ? "tbm" : "udm";
  console.log(`Request URL: ${buildSerpUrl(query, { shopping: true, shoppingMode: mode })}`);
  const { payload } = await serpRaw(query, { shopping: true, shoppingMode: mode });
  const raw = (payload ?? {}) as Record<string, unknown>;
  console.log(`Top-level keys: ${Object.keys(raw).join(", ")}`);
  const res = parseSerpPayload(query, payload);
  const priced = res.shopping.filter((s) => s.priceCents !== undefined);
  console.log(`shopping: ${res.shopping.length} results, ${priced.length} with parseable prices`);
  console.log(`organic:  ${res.organic.length} results`);
  console.log(`raw shopping array present: ${Array.isArray(raw.shopping)}${Array.isArray(raw.shopping) ? ` (length ${(raw.shopping as unknown[]).length})` : ""}`);
  if (Array.isArray(raw.shopping) && raw.shopping.length) console.log(`First raw shopping item:\n${JSON.stringify(raw.shopping[0], null, 2)}`);
  for (const s of res.shopping.slice(0, 5)) console.log(`  ${s.price ?? "(no price)"}  ${s.source ?? "?"}  ${s.title.slice(0, 60)}\n    ${s.link}`);
  console.log(
    res.shopping.length && priced.length
      ? "VERDICT: shopping is populated with prices."
      : res.shopping.length
        ? "VERDICT: shopping populated but no prices parsed (inspect the raw item above)."
        : "VERDICT: shopping is empty. Fall back to organic results (try --tbm too).",
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
