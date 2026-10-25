# Photo try-on

The costume page opens with the selected product flat-lay, followed by individual
products and the editorial reference. Local badges and collapsed pick explanations
remain beside the pieces. Wardrobe choices and budget changes belong to the voice
stylist. There is no shopping brief, event-date form, outfit comparison or final
plan screen. Voice changes update selected products directly. Shop for me and
photo try-on remain available.

## Local setup

1. Add `OPENAI_API_KEY` to the ignored `.env.local` file.
2. Restart the Next.js server so it loads the key.
3. Open a costume page and upload or take a photo of yourself.
4. Confirm photo processing and request a preview.

Photo try-on uses `gpt-image-2.5-flare` directly, with `quality=low` and a
672×1008 portrait (the smallest supported 2:3 image). `OPENAI_IMAGE_MODEL` can
override it. The API key stays on the server. Image access may require
organization verification. GPT Live styling uses its separate voice and Decisions models.

## Try-on behavior

Every generated photo preview uses a white commercial studio style: a seamless
white backdrop and floor, softbox lighting, natural contact shadows, and full-body
framing. The shopper remains the identity reference; the original room is removed.
Selected products and owned or skipped pieces still control the outfit.
Linen Ghost explicitly covers the head and body with the sheet, with two eye
openings and boots visible below the hem. It must not become an open cloak.

```text
Browser photo → resize + explicit consent → server decode + validation
  → image edit with main-subject selection and costume/product references
  → temporary browser preview + download
```

On mobile and touch devices, **Take photo** opens an image input with
`accept="image/*"` and `capture="environment"`, requesting the phone's rear camera.
**Upload photo** keeps the regular photo picker available. After selection,
**Retake photo** and **Change photo** use the same preparation flow. Browsers that
do not support camera capture can fall back to their regular file picker.

The browser accepts images it can decode and creates a JPEG under 3 MB,
with its longest edge at most 1600 pixels, before upload.
The server limits the request body to 4 MB, checks decoded image
dimensions, strips metadata, and rejects malformed or animated images.

The disclosure under **Try it on** explains that tapping sends the photo to OpenAI.
After generation, hold the image to compare, or use the keyboard-accessible
**Show original** button. **Save** downloads the current preview. Changing the
costume or wardrobe choices hides any preview that no longer matches.

`DECART_API_KEY` can be stored in the ignored `.env.local` for later experiments.
The current implementation does not call Decart or send it photos.

There is no photo-suitability classifier, person-count rejection, full-body
requirement, or minimum-resolution gate. The image model chooses the main
foreground subject and removes background people. Visual prominence, size,
sharpness, and central placement guide its choice. If several people are equally
prominent, the person nearest the center is selected. Selfies, cropped photos,
seated poses, occlusion, and clutter are passed directly to the model. Missing
regions are inferred for the finished portrait. Subject choice is model-generated
and can be ambiguous when people have equal prominence.

For the current outfit, product IDs are validated against the server catalog.
Garment-only product cutouts and descriptions guide the edit. Raw merchant
photos and editorial models are excluded so their faces cannot compete with
the shopper. Products without a cutout use their catalog descriptions.
Owned pieces retain the
corresponding photographed clothes where visible. Skipped pieces are omitted.
Other costumes use their descriptions; coming-soon concepts remain labeled
as inspiration. Remote merchant images are not fetched by this route.

The photo and current generated preview stay in page memory. The application does
not write them to files, browser storage, or its database. Remove photo,
reload, or closing the page clears that page's state. OpenAI processes the submitted
images under its API data policies. Downloads are saved only at the shopper's request.

Generated images approximate appearance. They do not verify fit, measurements,
fabric behavior, product accuracy, stock, or delivery.

Requests use origin checks, bounded uploads and provider timeouts. Demo testing
mode disables the per-process photo quota and concurrency guard; the production
photo firewall rule is also disabled. Outside testing mode, the app allows three
attempts per client address per hour and two concurrent requests per process.
See [testing policy and restoration steps](./mirror-session-limits.md).

## Verification

- `bun run typecheck`
- `bun run lint`
- `bun run build`
- `bun scripts/verify-try-on.mjs`
- `bun scripts/verify-try-on.mjs http://localhost:3102` also checks storefront wiring.

The last command runs the actual route, catalog lookup, file reads, and image
decoding. It replaces only the OpenAI HTTP boundary and the Next.js server-only
import marker. It checks all five costume references, selected products, owned
pieces, invalid uploads, consent, origin, small readable photos, provider errors,
quotas, and missing credentials. It does not establish real provider access or
rendering quality. A funded key and an authorized test photo are needed for that.

### Local production-build verification — October 24, 2026

The production build was tested with the configured OpenAI project and an entirely
synthetic full-body shopper photo. Both the Decisions and image-edit calls were real.

- The Cosmic Cowboy preview used selected catalog products.
- Changing to Velvet Vampire reused the same uploaded photo and produced another preview.
- The original-photo toggle and two-preview gallery worked.
- Both JPEG downloads completed in Aside and produced readable image files.
- A costume-only image, with no person, returned HTTP 422 and no generated image.
- Remove photo & previews cleared the photo, previews, consent, and preview controls.
- The build, targeted lint, route contract checks, and live storefront wiring checks passed.

The first product preview copied too much from the editorial reference. Removing
that competing reference improved the next output. Generated garment colors and
details still vary, so previews remain approximate and are not exact product or fit guarantees.

The in-app browser rendered the live result but did not confirm a native download.
Aside verified the download through the actual browser action. Whole-repository
lint also scanned generated files inside unrelated nested worktrees; lint of all
changed application files passed.

### Public production verification — October 24, 2026

The feature commit `8ddabb3` was already on remote `main`. Deployment
`dpl_5UCDFpp4yWhCHAHZr1uhdY22UMdY` rebuilt `62ef5d7` with the OpenAI key stored
as a sensitive production environment variable. Vercel reported READY and assigned
`halloween.supply`. Later commits through `d3bb20e` changed documentation and
prototype types; their production application code is identical.

The following checks ran against `https://halloween.supply`:

- Owning the Cowboy hat, skipping the optional scarf, and setting a $150 budget
  recalculated all three outfit comparisons. Applying Lowest cost selected a
  $108.90, three-piece purchase plan.
- Uploading a synthetic full-body shopper and confirming consent produced a real
  Cowboy preview with those product and wardrobe choices. Original-photo comparison worked.
- Choosing Moon Moth from the costume selector produced a real inspiration preview.
- Aside completed the native download of `moon-moth-try-on.jpg` (152,769 bytes).
- A product-only scarf photo returned HTTP 422. The fourth request from the test
  IP was denied by the shared firewall with HTTP 403.
- Remove photo & previews cleared the uploaded photo, preview, consent and controls.
- All five costume routes returned HTTP 200 with try-on, outfit comparisons on
  Cosmic Cowboy, and the existing Shop for me entry point.
- The production build, focused ESLint check and route contract checks passed.

The structured autoreview helper could not run because its configured `gpt-5.5`
model was unavailable for the signed-in Codex account. Direct code inspection and
the checks above completed; there is no successful automated review result.

Only synthetic shopper photos were submitted. The key and generated images were
not committed. Image appearance remains approximate. The shared IP limit can also
limit shoppers on the same network.

### Redesign release verification — October 24, 2026

Deployment `dpl_GGv6VTGJ14WTiaCAroSrKrqRVCV5` released `afb7b1b` to
`halloween.supply`. Vercel reported READY with the production domains assigned.

- A synthetic shopper photo passed preparation and produced a real OpenAI Cowboy preview.
- Enter on Show original and Show preview switched the displayed image in both directions.
- Save completed a native JPEG download in Aside (141,047 bytes).
- Changing the hat to Own it hid the previous preview and its Save control.
- Changing the photo to a product-only scarf showed the photo suitability error.
- Remove photo returned the form to its upload state.
- Layout checks at widths 390, 780 and 1280 found no horizontal overflow. The
  mobile layout showed Take photo, with `capture="environment"` on its input.
  A physical phone camera was not tested.
- Production build, focused lint, route contracts and all five live costume-page
  wiring checks passed. The storefront and health endpoint returned HTTP 200.

The review added a keyboard comparison control and included costume identity in
the preview key. Structured autoreview remained unavailable because its configured
model was unsupported. The Decart key was confirmed present locally without
printing it; no Decart integration or API request was added.

## API references

- [Decisions](https://developers.openai.com/api/docs/guides/decisions)
- [Image generation and edits](https://developers.openai.com/api/docs/guides/image-generation)


## Photo latency — October 25, 2026

The server prepares local garment references together, using JPEG at quality 85
and at most 768×1024 pixels. It caches at most 64 prepared catalog assets per
process, including concurrent requests for the same asset. Shopper photos and
outputs are never cached. Failed preparations are evicted. The shopper input
keeps its existing image bounds for identity detail.

Successful responses include `Server-Timing` for preparation and generation,
and `X-Try-On-Model` for release verification. There is one image edit request
per preview, with no classifier, model fallback, or automatic paid retry.

A synthetic catalog model and the same Pumpkin Harlequin selection were used
for real API comparisons. Each configuration ran twice. The first comparison
kept the exact prompt, seven image inputs, JPEG output, medium quality and
1024×1536 resolution unchanged. Test order was reversed for the second round.

| Configuration | Real generation times | Mean |
| --- | --- | --- |
| Sunburst, medium, 1024×1536 | 14.986 s, 14.295 s | 14.641 s |
| Flare, medium, 1024×1536 | 10.921 s, 11.075 s | 10.998 s |
| Flare, low, 672×1008, raw references | 9.687 s, 15.201 s | 12.444 s |
| Flare, low, compact JPEG references | 9.441 s, 10.615 s | 10.028 s |
| Flare, low, garment-only references | 9.530 s, 9.512 s | 9.521 s |

The model-only change reduced mean generation time by 24.9%. The final settings
and reference policy reduced it by 35.0% (about 1.54× as fast). These small
samples are observations, not latency guarantees or reliable tail estimates.
The low-quality result has less detail and lower resolution than the baseline.

Raw garment photos caused both tested models to borrow a merchant model's face.
The final reference policy removed those competing identities; both synthetic
outputs retained a recognisable likeness on visual inspection. This is not
pixel-identical face preservation or proof for every real shopper.

Prepared request content fell from 5,095,200 bytes to 117,418 bytes for this
selection (97.7% smaller). Cold preparation in the benchmark harness fell from
449 ms to 149 ms; this excludes the browser upload and app-server transport.
The actual local browser upload flow took 9.536 s from button click to visible
preview, with 385.7 ms server preparation and 7.824 s provider generation.
Before/after comparison, download, reset and browser error checks passed.

Reproduce the paid synthetic comparison with:

```sh
BENCHMARK_IMAGE_EDITS=1 bun --env-file=.env.local scripts/benchmark-try-on.mjs /tmp/photo-benchmark
```

The script captures the current real route's prepared input using a simulated
capture response. Every timed generation then calls the real Image API. Its
results include prompt hashes, input sizes, settings and generated files.
Baseline results above were captured before reference optimization. Rerunning
now uses the current reference policy, so it does not reproduce the old payload.

Official guidance: https://developers.openai.com/api/docs/guides/image-prompting
