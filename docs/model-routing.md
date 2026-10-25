# Model routing and Decisions

These are code defaults. Server environment variables can override some models. An SDK version is separate from the selected model.

| Work | Default model | API | Code |
| --- | --- | --- | --- |
| Screenshot decomposition, character verification, merchant shortlisting, visual offer comparison | `gpt-6.1-sol` | Responses | `lib/sourcing/screenshot-vision.ts` |
| Independent screenshot search and Firecrawl outage recovery | `gpt-6-luna` | Responses with live `web_search` | `lib/sourcing/discovery.ts` |
| Complete-outfit recommendation | `gpt-6-luna` | Decisions | `lib/stylist/decide.ts` |
| Mirror command choices and voice delegation | `gpt-6-luna` | Decisions | `lib/live-mirror/voice-decisions.ts`, mirror command/voice routes |
| Mirror catalog reasoning and numeric budget extraction | `gpt-6-luna` | Responses | `lib/live-mirror/catalog-server.ts`, mirror command route |
| Conversation and speech | `gpt-live-1` | Live sessions over WebRTC | `app/api/live-mirror/voice/route.ts` |
| Personal-photo costume render | `gpt-image-2.5-sunburst` | Images edits | `app/api/try-on/route.ts` |
| Shopping chat, semantic catalog search, custom-look plans and product extraction | `claude-sonnet-5-5` | Anthropic via AI SDK | `lib/ai/models.ts` and its callers |
| Personal 3D generation | Meshy 7.1 / Hunyuan 3D 3.1 Pro / TRELLIS.2 | fal image-to-3D | `lib/try-on-3d/server.ts` |
| Live video rendering | `decart/lucy-2-5/realtime` | fal streaming video | `lib/live-mirror/video-server.ts` |

`OPENAI_VISION_MODEL` controls screenshot vision. `OPENAI_SEARCH_MODEL` controls its backup search. `OPENAI_DECISION_MODEL`, `OPENAI_MIRROR_REASONING_MODEL`, `OPENAI_LIVE_MODEL`, and `OPENAI_IMAGE_MODEL` control their corresponding paths. Outfit recommendation intentionally fixes its Decisions model to Luna, which is also the only currently supported Decisions model.

## What Decisions does

The Decisions API answers bounded questions from supplied choices. The app supplies actual product IDs and action names, then validates answers before applying them. It cannot invent a SKU, create a Stripe charge, or order a merchant product.

1. **Outfit recommendation:** the server first enumerates feasible complete outfits under size, budget, ownership, optional-piece and lock constraints. Decisions chooses among those complete combinations or returns `review_needed`. Large sets use groups and finalists. The entry point is `POST /api/outfits`.
2. **Mirror commands:** `POST /api/live-mirror/command` asks whether to switch looks, search inventory, choose a known piece option, declare a piece owned, skip an optional item, lock/unlock, undo, save, freeze, resume, or optimize. Questions and comparisons do not authorize outfit changes. Catalog retrieval and free-form budget parsing use separate Responses requests when needed.
3. **Live voice:** `POST /api/live-mirror/voice` configures GPT-Live delegation to Decisions. Transcript-triggered focus questions highlight the discussed piece. Delegated action answers pass through the same catalog and state checks before an outfit changes.

The earlier photo-suitability Decisions gate was removed from main to support casual try-on uploads. Photo rendering now goes directly to the image-edit path after file decoding and request checks. Screenshot analysis uses Responses and structured JSON rather than Decisions.

## Model choices

No active GPT-4 or GPT-5 defaults were found in the audited application paths. Sol remains appropriate for difficult image understanding. Luna suits bounded actions and focused search planning. Sonnet 5.5 is a current model; switching it is an evaluation decision rather than an obsolete-model repair.

The clearest further speed opportunity is benchmarking routine classification or product extraction on Luna or Decisions. Keep free-form reasoning where the task needs it, and compare real accuracy and latency before migrating. Do not infer application speed from a provider's model benchmark.

References: [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model), [Decisions](https://developers.openai.com/api/docs/guides/decisions), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [Claude models](https://platform.claude.com/docs/en/models/overview).
