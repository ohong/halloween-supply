# Personal 3D costume previews

Users first create the existing photo try-on with their chosen products. Below that result, **Create my 3D look** converts the dressed preview into a textured GLB. The original upload alone is not a dressed 3D input.

The viewer supports orbit, zoom, keyboard rotation, whole-look reset, and an item index. Selecting a piece changes the camera angle and target. A projected rectangle follows its focus region while the camera moves. Reduced-motion preferences and keyboard selection use immediate camera changes.

## Provider decision — October 25, 2026

The default is **Hunyuan 3D 3.1 Pro through fal**, using `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d`, as selected by the project owner. TRELLIS.2 and Meshy 7.1 remain available through explicit `TRY_ON_3D_PROVIDER` overrides. All three use the existing `FAL_KEY`. Existing signed jobs retain their original provider.

The previous provider evaluation compared one dressed try-on image (the knit model). These historical observations are not a general quality benchmark:

| Model | Cost per generation | Settings | Result |
| --- | --- | --- | --- |
| TRELLIS.2 | $0.30 (1024p) | 40k vertices, 1024px texture | Faithful colors, best face and hair detail. 1.6 MB, 53 s on the knit photo. |
| Hunyuan 3D 3.1 Pro | $0.525 (with `face_count`) | 40k faces | Faithful colors, softer detail. 53.6 MB at default settings. |
| Rodin 2.5 | $0.40 | PBR | Washed-out, near-white textures. Not wired in. |
| Meshy 7.1 | $1.20 (textured) | 40k polygons, remeshed | Good shape, but the slowest (198 s) at 4× the TRELLIS price. 4.4 MB. |

Hunyuan uses the existing textured `Normal` mode and 40k-face target to limit browser rendering cost. This change selects the requested model; it does not establish a new quality benchmark.

Sources:

- [TRELLIS.2 on fal: request and response schema](https://fal.ai/models/fal-ai/trellis-2/api)
- [Meshy 7.1 on fal: request and response schema](https://fal.ai/models/meshy/v7.1/image-to-3d/api)
- [Hunyuan input/output schema](https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/pro/image-to-3d/api)
- [Interaction reference](https://www.paradigm.xyz/frontiers-2026/merch)

## Configuration

- `FAL_KEY`: enables 3D generation for every provider.
- `TRY_ON_3D_PROVIDER`: optional `hunyuan` (default), `trellis` or `meshy`. An unknown value falls back to `hunyuan`.
- `TRY_ON_3D_SIGNING_SECRET`: optional dedicated signing key, stable across deployment instances. Falls back to `FAL_KEY`.

No provider key reaches the browser. Without `FAL_KEY`, photo try-on remains available and 3D reports its unavailable state.

## Architecture and choices

```text
shopper photo + exact product selection
                |
       existing OpenAI photo try-on
                |
    dressed image + signed image digest
                |
        explicit 3D consent
                |
        submit provider task ----> signed task token
                                        |
                                poll status every 5s
                                        |
                                  textured GLB
                                        |
                         browser camera + focus region
```

Two approaches were considered. A reusable avatar with separately fitted garments can update quickly, but requires fitted meshes for every product and avatar. Reconstructing the complete dressed preview works with the existing catalog and image-edit pipeline. This implementation chooses reconstruction, accepting a new generation when the shopper changes their outfit.

For the viewer, a custom Three.js camera provides direct control over focus animation and projecting borders onto the screen. It avoids a second React rendering layer. The renderer only draws on load, resize, camera movement, or transitions, and releases GPU resources when removed. Three.js loads only after a model is ready. Draco decoders are served locally under `public/draco`.

The source preview ticket expires after one hour and binds the exact image digest and provider. The model token grants status access for 24 hours. Requests use bounded bodies (4.4 MB images, below Vercel's 4.5 MB function body limit), same-origin checks, consent validation, and no-store responses. Arbitrary image URLs and arbitrary provider task IDs are not accepted from clients. Provider error text is not exposed.

Duplicate submissions for one preview share a promise **within one server instance**. The existing photo-try-on quota is also instance-local. Production-wide cost control and idempotency require a shared store or hosting firewall. This work does not claim distributed enforcement.

fal reports a failed job as `COMPLETED` and answers its result request with an HTTP error. The status route treats that as a failed generation and stops polling, instead of retrying forever. Transient status failures retry the existing job. Pausing updates stops polling, not the provider job. Polling can resume from the same token within the page. Reloading or leaving loses the local result; this app does not persist personal photos, previews, models, or job tokens. Provider retention is separate and is disclosed before submission.

## Limits and validation

Focus boxes are approximate anatomical regions inferred from catalog piece names/categories. They are not garment segmentation. Unknown accessories use a whole-body view. Single-image reconstruction invents unseen surfaces and cannot guarantee facial likeness, garment fit, or accurate rear details.

Checked locally:

- Production `bun run build`: passed, including both new API routes.
- TypeScript and ESLint on the changed feature files.
- `bun scripts/verify-try-on.mjs`: existing photo path, costume/product validation, rejection handling, quota, and missing-key behavior. OpenAI HTTP is simulated.
- `bun scripts/verify-try-on-3d.mjs`: real route handlers with simulated provider HTTP; tests consent, origin, signed image binding, token tampering/purpose/expiry, body limits, concurrent deduplication, provider settings, progress, completion, failures, and transient errors.
- Real end-to-end run through the local dev server with a synthetic photo (no personal photo): photo try-on (17 s), TRELLIS.2 submit, status ready after 27 s, 2.3 MB GLB.
- The same flow in the local browser on Velvet Vampire: the TRELLIS GLB renders in the viewer, selecting the waistcoat moves the camera and draws its focus box, and the console has no errors.

Not established: a multi-image quality benchmark, personal likeness on a real shopper photo, or physical mobile GPU behavior.
