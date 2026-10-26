# Responsible use

Screenshot sourcing takes a photo of a person and turns it into a shopping list, so the system is built to read clothing and nothing else. It never identifies who is in the photo, never keeps the photo, and never buys anything without the shopper choosing it. This page lists each safeguard with the code or configuration that enforces it, so a reviewer can check the claim instead of trusting it.

## The photo

**Consent and upload.** The shopper chooses a file or takes a photo on the `/screenshot` page; nothing is captured in the background. The route rejects requests from other origins (`app/api/screenshot-costume/route.ts`, origin check before the body is read), so another site cannot post images through a visitor's browser.

**Metadata is stripped before analysis.** The route re-encodes every upload with `sharp`: it applies the EXIF rotation, flattens it to one frame, resizes it to at most 1024 px and writes a fresh JPEG (`readPhoto` in `app/api/screenshot-costume/route.ts`). GPS coordinates, camera serials and other EXIF fields never reach the vision service. Uploads over 4 MB or under 64 px are refused.

**Images are not stored.** The screenshot route keeps the image in memory for the length of one request. It does not write it to Turso, Blob storage or disk. The vision service receives bytes in the request body and returns its answer; it has no storage volume and no database. TODO(verify): confirm in `vision/app/` that no handler writes request images to disk.

**Images and embeddings are not logged.** The vision service writes one JSON line per request with the route, status, latency, stage timings, piece count and build (contract and `vision/app/`). It does not log image bytes, crops or embeddings. The Next.js trace contains scores, color names and queries, not pixels. TODO(verify): confirm the log line fields in `vision/app/` and the trace fields in `lib/sourcing/`.

**The service never fetches URLs.** Callers send image bytes, not links (`plans/contract.md`, Transport), so the vision service cannot be used to reach internal AWS addresses (SSRF).

## The person in the photo

**No face identification.** The models are a clothes-parsing segmenter (SegFormer, 18 garment and body-part labels) and a CLIP image encoder that is only compared against a garment vocabulary (`vision/vocabulary.json`). No face recognition, face embedding or identity model is loaded. Face and hair regions from the segmenter are used only to exclude them from garment crops. TODO(verify): confirm face/hair labels are discarded in `vision/app/`.

**The title never names a person.** The look title is built deterministically from the strongest garment phrase, for example "Cowboy look" (contract, `/v1/analyze` notes). The previous design asked a language model for a title, which could name a celebrity or a private person; the OpenCV path cannot, because its vocabulary contains garments only.

**One person at a time.** When the segmenter finds no person, or its confidence is below 0.5, the agent stops before searching and asks the shopper to crop to one person (`decideNext` rules, TODO(verify) in `lib/sourcing/`). This avoids mixing garments from several people into one outfit.

**Minors.** The store sells adult costumes and its catalog excludes child-size substitutions (`docs/screenshot-sourcing.md`, relevance rules). The upload page does not ask for age, and the system does not estimate age from the photo, because age estimation is itself a face-analysis task. The safeguards above (no storage, no identification, no logging of pixels) apply to every photo, including a photo of a child that a parent uploads to find a matching costume.

## Decisions the shopper makes

**Weak matches need approval.** When the agent cannot find a product photo that OpenCV scores as a `match` after its retries, it keeps the best `weak` candidate and marks the piece `needs_approval`. The shopper sees the product photo, the measured colors and the scores, and chooses "Use this anyway" or "Skip piece". A piece in that state is not added to the cart until the shopper chooses. TODO(verify): confirm in `app/screenshot/` and its components.

**Nothing is bought without the shopper.** The agent can search, score and suggest; it cannot pay. Purchases go through Stripe Checkout, which the shopper opens and completes. Checkout rechecks each merchant's current price, size and stock, and the shopper approves any price change before paying (root `README.md`, Catalog and checkout).

**Evidence is visible.** Every decision appears in the "How we matched this" panel with the OpenCV crop, the measured colors, the match scores and the retries the agent made, so the shopper can see why a product was chosen and disagree with it. TODO(verify): panel contents in `app/screenshot/`.

## Operating the service

**Least-privilege IAM.** The EC2 instance role can pull from one ECR repository, read one SSM parameter (the service token) and write to CloudWatch. It has no other AWS permissions. TODO(verify): policy in `infra/`.

**No SSH.** The instance has no key pair and no inbound port 22; operators use SSM Session Manager. IMDSv2 is required and the EBS volume is encrypted. TODO(verify): `infra/30-instance.sh`.

**Network exposure.** The origin security group accepts traffic only from CloudFront's managed prefix list, and every request except `/healthz` needs the bearer token from SSM. Requests over 4 MB per image or 12 images are rejected with 413. TODO(verify): `infra/10-network-iam.sh`, `infra/40-cloudfront.sh`, `vision/app/`.

**Cost limits.** The deployment is one Graviton instance behind CloudFront with caching disabled. The benchmark instances are started by `infra/60-bench-instances.sh up` and terminated by `down` after the run; `infra/99-teardown.sh` removes everything. The Next.js route allows at most 4 concurrent screenshot requests per server instance and stops all work at 30 s (`app/api/screenshot-costume/route.ts`). TODO(numbers): hourly cost from `infra/README.md`.

## Known gaps

- We have not measured how segmentation and color naming vary across skin tones, body types, lighting or image style. Our evaluation set is 25 generated editorial images, which is too small for that, so these differences are unmeasured rather than absent. TODO(numbers): link the failure cases in `eval/out/`.
- The garment vocabulary is English and skews toward Western retail and costume terms, so garments outside it get the nearest listed phrase.
- The vision service has a shared bearer token, not per-user authentication. It is a backend for one storefront, not a public API.
