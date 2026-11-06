import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Agent guardrails. Each rule says what to do instead.
const MODEL_ID = "^(gpt-|claude-|o\\d|gemini-|fal-ai.|decart.|meshy.)";
const PROVIDER_URL = "api\\.openai\\.com|api\\.anthropic\\.com|fal\\.run|api\\.decart|api\\.firecrawl\\.dev";
const stringsMatching = (pattern, message) => [
  { selector: `Literal[value=/${pattern}/]`, message },
  { selector: `TemplateElement[value.cooked=/${pattern}/]`, message },
];
const MODEL_MESSAGE = "Model IDs live in lib/ai/models.ts - import from there.";
const GUARD_MESSAGE = "Use guardProvider() from lib/guard.ts instead of a module-level active counter.";
const PROVIDER_MESSAGE = "Provider HTTP calls live in the provider modules (lib/ai, lib/firecrawl, lib/live-mirror, lib/sourcing, lib/try-on-3d) - import a client or constant from there.";
const guardSelector = { selector: "Program > VariableDeclaration[kind='let'] > VariableDeclarator[id.name=/^active/i]", message: GUARD_MESSAGE };

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/**", "lib/**"],
    rules: { "no-empty": ["error", { allowEmptyCatch: false }] },
  },
  {
    files: ["app/**", "lib/**", "components/**"],
    ignores: ["lib/ai/models.ts"],
    rules: { "no-restricted-syntax": ["error", ...stringsMatching(MODEL_ID, MODEL_MESSAGE), guardSelector] },
  },
  {
    files: ["app/**", "components/**", "lib/**"],
    ignores: ["lib/ai/**", "lib/firecrawl/**", "lib/live-mirror/**", "lib/sourcing/**", "lib/try-on-3d/**", "lib/ai/models.ts"],
    rules: { "no-restricted-syntax": ["error", ...stringsMatching(MODEL_ID, MODEL_MESSAGE), guardSelector, ...stringsMatching(PROVIDER_URL, PROVIDER_MESSAGE)] },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    "data/cache/**",
    "tmp/**",
    // Agent worktrees are full copies of the app; lint only this checkout.
    ".claude/**",
    // Vendored upstream Draco decoder; keep its distributed source intact.
    "public/draco/**",
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
