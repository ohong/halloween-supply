# Responsible use

Screenshot sourcing takes a photo of a person and turns it into a shopping list, so the system is built to read clothing and nothing else. It never identifies who is in the photo, never keeps the photo, and never buys anything without the shopper choosing it. This page lists each safeguard with the code or configuration that enforces it, so a reviewer can check the claim instead of trusting it.

## The photo

**Consent and upload.** The shopper chooses a file or takes a photo on the `/screenshot` page; nothing is captured in the background. The route rejects requests from other origins (`app/api/screenshot-costume/route.ts`, origin check before the body is read), so another site cannot post images through a visitor's browser.

**Metadata is stripped before analysis.** The route re-encodes every upload with `sharp`: it applies the EXIF rotation, flattens it to one frame, resizes it to at most 1024 px and writes a fresh JPEG (`readPhoto` in `app/api/screenshot-costume/route.ts`). GPS coordinates, camera serials and other EXIF fields never reach the vision service. Uploads over 4 MB or under 64 px are refused.

**Images are not stored.** The screenshot route keeps the image in memory for the length of one request. It does not write it to Turso, Blob storage or disk. The vision service receives bytes in the request body and returns its answer; it has no storage volume and no database. The only file the service code opens is the model weights, read at startup ([`vision/app/models.py`](../../vision/app/models.py)); no handler writes to disk.

**Images and embeddings are not logged.** The vision service writes one JSON line per request with the route, status, latency in ms, OpenCV build, git commit and stage timings, plus the piece count and person-found flag for analyze or the candidate count for match, and the exception text on a 500 ([`vision/app/main.py`](../../vision/app/main.py)). It does not log image bytes, crops or embeddings, and uvicorn's access log is off. The agent trace that the route writes to the Vercel log as one `screenshot_agent_trace` line contains steps, scores, color names and queries, not pixels or crops ([`route.ts`](../../app/api/screenshot-costume/route.ts)). CloudWatch keeps the service log for 14 days ([`infra/50-observability.sh`](../../infra/50-observability.sh)).

**The service never fetches URLs.** Callers send base64 image bytes in the JSON body, not links, and the service has no HTTP client ([`vision/app/main.py`](../../vision/app/main.py)), so the vision service cannot be used to reach internal AWS addresses (SSRF).

## The person in the photo

**No face identification.** The models are a clothes-parsing segmenter (SegFormer, 18 garment and body-part labels) and a CLIP image encoder that is only compared against a garment vocabulary (`vision/vocabulary.json`). No face recognition, face embedding or identity model is loaded. Face, hair, arm and leg labels never become pieces ([`vision/app/models.py`](../../vision/app/models.py), `REGION_LABELS`). The service does embed one whole-figure crop, which includes the face, but only to help classify garments against the garment vocabulary; that embedding is never returned or logged ([`vision/app/analyze.py`](../../vision/app/analyze.py)). On product photos, body-part labels are used only to tell a worn garment from a flat product shot ([`vision/app/match.py`](../../vision/app/match.py)).

**The title never names a person.** The look title is built deterministically from the strongest garment phrase, for example "Cowboy look", using a fixed list of costume theme words or else the phrase's last word (`title` in [`vision/app/analyze.py`](../../vision/app/analyze.py)). The previous design asked a language model for a title, which could name a celebrity or a private person; the OpenCV path cannot, because its vocabulary contains garments only.

**One person at a time.** When the segmenter finds no person, its confidence is below 0.5, or no garments come back, the route stops with a 422 before any search and asks the shopper to crop the screenshot to one person, head to toe ([`route.ts`](../../app/api/screenshot-costume/route.ts), `MIN_PERSON_CONFIDENCE`). This avoids mixing garments from several people into one outfit.

**Minors.** The store sells adult costumes and its catalog excludes child-size substitutions (`docs/screenshot-sourcing.md`, relevance rules). The upload page does not ask for age, and the system does not estimate age from the photo, because age estimation is itself a face-analysis task. The safeguards above (no storage, no identification, no logging of pixels) apply to every photo, including a photo of a child that a parent uploads to find a matching costume.

## Decisions the shopper makes

**Weak matches need approval.** When the agent cannot find a product photo that OpenCV scores as a `match` after its retries, it keeps the best `weak` candidate and sends it as an approval instead of a match. The shopper sees the product photo, the merchant, the price and the reason (for example "No confident match after two retries."), and chooses "Use this anyway" or "Skip piece". A piece in that state is not added to the cart until the shopper chooses ([`components/store/screenshot-costume.tsx`](../../components/store/screenshot-costume.tsx)).

**Nothing is bought without the shopper.** The agent can search, score and suggest; it cannot pay. Purchases go through Stripe Checkout, which the shopper opens and completes. Checkout rechecks each merchant's current price, size and stock, and the shopper approves any price change before paying (root `README.md`, Catalog and checkout).

**Evidence is visible.** Each matched piece has a "How we matched this" panel with the OpenCV crop, the measured colors and their shares, the top garment types, every search query, the top three scores with their verdicts and reasons, and each retry with its cause, so the shopper can see why a product was chosen and disagree with it ([`components/store/screenshot-costume.tsx`](../../components/store/screenshot-costume.tsx)). A look restored from the cart doesn't show the panel, because the trace isn't saved.

## Operating the service

**Scoped IAM.** The instance role's own policy can pull from one ECR repository, read two SSM parameters (the service token and the image tag), write to one CloudWatch log group and use one benchmark S3 bucket ([`infra/10-network-iam.sh`](../../infra/10-network-iam.sh)). It also carries the AWS managed policies `AmazonSSMManagedInstanceCore` and `CloudWatchAgentServerPolicy`, which Session Manager and the CloudWatch agent need and which are broader than the rest.

**No SSH.** The instance has no key pair and no inbound port 22; operators use SSM Session Manager. IMDSv2 is required and the EBS volume is encrypted ([`infra/30-instance.sh`](../../infra/30-instance.sh)).

**Network exposure.** The origin security group accepts traffic only from CloudFront's managed prefix list, and every request except `/healthz` needs the bearer token from SSM ([`infra/10-network-iam.sh`](../../infra/10-network-iam.sh), [`infra/40-cloudfront.sh`](../../infra/40-cloudfront.sh)). The hop from CloudFront to the instance is plain HTTP inside that restriction, so the token and image bytes are not encrypted on it; an origin certificate would fix that. The service refuses images over 4 MB decoded and more than 12 candidate photos per call with a 413 ([`vision/app/imageio.py`](../../vision/app/imageio.py), [`vision/app/main.py`](../../vision/app/main.py)).

**Cost limits.** The deployment is one Graviton instance behind CloudFront with caching disabled. It costs about $0.18 an hour on demand, including the COOL software fee ([`infra/README.md`](../../infra/README.md)). The benchmark instances are started by `infra/60-bench-instances.sh up`, have no inbound ports, and power off and terminate themselves 4 hours after boot even if nobody runs `down`; `infra/99-teardown.sh` removes everything after asking for confirmation. The Next.js route allows at most 4 concurrent screenshot requests per server instance (a 429 after that), gives search a 30 s budget and has a 40 s function limit ([`route.ts`](../../app/api/screenshot-costume/route.ts)).

## Known gaps

- We have not measured how segmentation and color naming vary across skin tones, body types, lighting or image style. Our evaluation set is 25 generated editorial images, which is too small for that, so these differences are unmeasured rather than absent. The failure cases we did see are in [report section 8](report.md#8-evaluation).
- The garment vocabulary is English and skews toward Western retail and costume terms, so garments outside it get the nearest listed phrase.
- The vision service has a shared bearer token, not per-user authentication. It is a backend for one storefront, not a public API.
