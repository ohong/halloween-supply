# Personal 3D costume previews

Users first create the existing photo try-on with their chosen products. Below that result, **Create my 3D look** converts the dressed preview into a textured GLB. The original upload alone is not a dressed 3D input.

The viewer supports orbit, zoom, keyboard rotation, whole-look reset, and an item index. Selecting a piece changes the camera angle and target. A projected rectangle follows its focus region while the camera moves. Reduced-motion preferences and keyboard selection use immediate camera changes.

## Provider decision — October 25, 2026

The default is **Meshy 7.1 through fal**. Both Meshy and the optional Hunyuan 3D 3.1 Pro endpoint use the existing `FAL_KEY`. No separate Meshy account key is needed.

Meshy uses standard geometry, textures, remeshing, a 40,000 target polygon count, and safety checking. Hunyuan uses textured output and 40,000 target faces. Neither requests PBR materials. These settings aim to keep browser rendering practical; no head-to-head quality benchmark has been completed.

Sources:

- [Meshy 7.1 on fal: request and response schema](https://fal.ai/models/meshy/v7.1/image-to-3d/api)
- [Hunyuan input/output schema](https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/pro/image-to-3d/api)
- [Interaction reference](https://www.paradigm.xyz/frontiers-2026/merch)

## Configuration

- `FAL_KEY`: enables 3D generation for both providers.
- `TRY_ON_3D_PROVIDER`: optional `meshy` (default) or `hunyuan`.
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

The source preview ticket expires after one hour and binds the exact image digest and provider. The model token grants status access for 24 hours. Requests use bounded bodies, same-origin checks, consent validation, and no-store responses. Arbitrary image URLs and arbitrary provider task IDs are not accepted from clients. Provider error text is not exposed.

Duplicate submissions for one preview share a promise **within one server instance**. The existing photo-try-on quota is also instance-local. Production-wide cost control and idempotency require a shared store or hosting firewall. This work does not claim distributed enforcement.

Transient status failures retry the existing job. Pausing updates stops polling, not the provider job. Polling can resume from the same token within the page. Reloading or leaving loses the local result; this app does not persist personal photos, previews, models, or job tokens. Provider retention is separate and is disclosed before submission.

## Limits and validation

Focus boxes are approximate anatomical regions inferred from catalog piece names/categories. They are not garment segmentation. Unknown accessories use a whole-body view. Single-image reconstruction invents unseen surfaces and cannot guarantee facial likeness, garment fit, or accurate rear details.

Checked locally:

- Production `bun run build`: passed, including both new API routes.
- TypeScript and ESLint on the changed feature files.
- `bun scripts/verify-try-on.mjs`: existing photo path, costume/product validation, rejection handling, quota, and missing-key behavior. OpenAI HTTP is simulated.
- `bun scripts/verify-try-on-3d.mjs`: real route handlers with simulated provider HTTP; tests consent, origin, signed image binding, token tampering/purpose/expiry, body limits, concurrent deduplication, provider settings, progress, completion, failures, and transient errors.
- One real fal generation from the synthetic Cosmic Cowboy catalog image. No personal photo was used in this validation. The running Next.js status endpoint returned HTTP 200 with the completed model.
- The resulting real GLB was exercised in the local browser: hat and footwear focus, orbit, keyboard rotation/reset, resize, and a measured 480 CSS-pixel layout with no horizontal overflow. Browser console had no warnings/errors during that viewer check.

Not established: a head-to-head quality/latency benchmark, personal likeness on a real shopper photo, physical mobile GPU behavior, or a deployed release.
