<!-- take-notes-session: "01a1728f-44a0-7501-9765-42879e58ed8c" -->
# Demo and product ideas

<!-- take-notes-payload-sha256: a4be136abc814d25c18b8455c89434b85cd01e9a9d69729974ea089212584d08 -->
# Demo and experience notes

- A short demo can follow one visible arc: inspiration image, sourced pieces, then a personal preview. Show what changes on screen and explain why it matters. Prepare genuine completed provider results for a timed recording. Do not present a replay as a live search.
- The strongest first-use surprise is continuity. Let a screenshot become an editable set of real products, then use those exact choices for a personal preview and a shareable look card.
- Keep the complete outfit visible during refinements. A piece swap should update its product photo, flat lay, and subtotal together. Mark missing products and uncertain stock clearly.
- A share card can carry the preview, costume name, key pieces, and a link that restores exact choices. It should look like a finished editorial object.
- A personal photo effect alone is a weak distinction. TryDrobe advertises photo try-on from a costume screenshot: https://trydrobe.com/halloween-costume-try-on. AnyWear advertises live try-on from clothing images and links: https://anywear.live/.

# Assistant and UI patterns

- Shopping capability grows from grounded tools and retained task state. A shopper can give a budget, owned pieces, local preference, and event date. The app can show which constraints it met and which facts remain unknown.
- A durable agent framework helps when a shopping task must survive browser closure, wait for approval, or monitor products later. A short catalog comparison can remain in the current tool loop. Eve describes durable sessions and approval gates: https://eve.dev/docs/getting-started.
- OpenAI Decisions returns a predicate, a choice from supplied values, or a rubric score. It can select trusted product IDs and predefined UI views. The app must validate those IDs and render the components. For an arbitrary generated JSON object, OpenAI directs developers to Responses with Structured Outputs: https://developers.openai.com/api/docs/guides/decisions.
- No official Decisions shopping or generative UI Cookbook recipe was found during this conversation. The official guide shows product-photo damage checks and fixed-choice routing. The voice guide shows Decisions selecting app actions: https://developers.openai.com/api/docs/guides/decisions-voice.

Coverage: This note records reusable demo, product, and API ideas discussed in this session through October 25, 2026. It excludes task status and implementation decisions.
