# Outfit planner and photo try-on

The live costume page has a shopping brief and three complete outfit comparisons.
Every costume page also has a photo try-on form. The existing Shop for me component is unchanged.

## Local setup

1. Add `OPENAI_API_KEY` to the ignored `.env.local` file.
2. Restart the Next.js server so it loads the key.
3. Open a costume page and upload a clear, fully clothed full-body photo.
4. Confirm photo processing and request a preview.

The default models are `gpt-6-luna` for the Decisions API and
`gpt-image-2.5-sunburst` for image edits. Optional `OPENAI_DECISION_MODEL` and
`OPENAI_IMAGE_MODEL` settings override them. The API key stays on the server.
Your OpenAI project needs access to both models; image access may require organization verification.

## Outfit behavior

- The brief records a pieces budget, event date, size labels, and a styling preference.
- Each piece is bought or owned. Optional pieces can also be skipped.
- Owned and skipped pieces leave the cart and add nothing to the budget.
- Lowest cost minimizes the pieces subtotal.
- Closest to the look minimizes catalog styling rank, with extra weight for the selected merchant preference.
- Fewest shops minimizes merchant count, then cost.
- All three honor the budget when a matching combination exists. Otherwise, they show the cheapest combination and disable selection.
- Sold-out products and known size mismatches are excluded. Unknown stock and sizes remain visible with notices.
- Missing pieces produce an incomplete plan, with selection disabled.
- Use this outfit applies product choices and updates matching pieces already in the cart.
- Add remaining pieces adds only purchases. Sizes from the brief accompany those cart lines.
- Event dates are planning context. The app does not claim or verify arrival dates.
- Shipping and tax are excluded. Brief and wardrobe choices last for the current page visit.

The comparison algorithm evaluates whole combinations and discards dominated states
for each merchant set. This preserves the cheapest, best styling, and fewest-shop
choices without making model calls or inventing products.

## Try-on behavior

```text
Browser photo → resize + explicit consent → server decode + validation
  → Decisions photo suitability check → image edit with costume/product references
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

Decisions classifies the photo as usable, cropped, multiple people, or unsuitable.
Only usable photos reach the image model. Refusals stop the request.

For the current outfit, product IDs are validated against the server catalog.
Local product images and descriptions guide the edit. Product-specific previews
exclude the editorial image so its garments cannot compete with selected products.
Owned pieces retain the
corresponding photographed clothes where visible. Skipped pieces are omitted.
Other costumes use their editorial image and descriptions; coming-soon concepts
remain labeled as inspiration. Remote merchant images are not fetched by this route.

The photo and current generated preview stay in page memory. The application does
not write them to files, browser storage, or its database. Remove photo,
reload, or closing the page clears that page's state. OpenAI processes the submitted
images under its API data policies. Downloads are saved only at the shopper's request.

Generated images approximate appearance. They do not verify fit, measurements,
fabric behavior, product accuracy, stock, or delivery.

Requests use origin checks, bounded uploads, timeouts, and a per-process cost guard:
three attempts per client address per hour, two concurrent requests per process.
These are not deployment-wide quotas. Production also has a Vercel firewall rule
for POST `/api/try-on`: three requests per client IP per hour, using a fixed
window and a deny action. The rule applies across function instances and deployments.
It counts rejected uploads too. It does not impose a total project spending cap.

## Verification

- `bun run typecheck`
- `bun run lint`
- `bun run build`
- `bun scripts/verify-try-on.mjs`
- `bun scripts/verify-try-on.mjs http://localhost:3102` also checks storefront wiring.

The last command runs the actual route, catalog lookup, file reads, and image
decoding. It replaces only the OpenAI HTTP boundary and the Next.js server-only
import marker. It checks all five costume references, selected products, owned
pieces, invalid uploads, consent, origin, photo rejection, provider errors,
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

## API references

- [Decisions](https://developers.openai.com/api/docs/guides/decisions)
- [Image generation and edits](https://developers.openai.com/api/docs/guides/image-generation)
