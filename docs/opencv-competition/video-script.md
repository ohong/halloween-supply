# Video script (4:45 target, 5:00 hard limit)

The video has to show three things the judges score: that OpenCV 5 does the perception, that its measurements change what the agent does next, and that it runs on AWS Graviton with COOL. Every claim in the voice-over below has a matching line in `report.md`; if a number changes there, change it here too.

## Before recording

- Production (or a preview deployment) has `SCREENSHOT_VISION=opencv`, and `curl $VISION_SERVICE_URL/healthz` shows `"build":"cool"` and `"arch":"aarch64"`.
- Pick the demo screenshot ahead of time and run it twice, so the merchant search cache is warm and you know which piece triggers a retry. Use a run where the trace shows a `color_mismatch` or `type_mismatch` retry that then finds a `match`. TODO(verify): name the image once `eval/traces/` has a recorded retry.
- Open these tabs in order: halloween.supply `/screenshot`, the CloudWatch dashboard, `report.md` results table (or `eval/out/agent.md`), `vision/bench/out/cool.md`, `architecture.svg`.
- Browser at 1440 px wide, zoom 125%, notifications off. Record at 1080p.

## Shot list

| # | Time | Shot | Voice-over (say roughly this) |
|---|---|---|---|
| 1 | 0:00–0:20 | Team on camera. | "We're [names] and this is halloween.supply. You show it a photo of a costume, and it finds each piece at real merchants, so you can buy the look." |
| 2 | 0:20–0:45 | Team on camera, or a phone scrolling a costume screenshot. | "The hard part is perception. A screenshot is a person, not a product list. Our old version sent it to a language model twice per request, once to list the garments and once to check the product photos, so we couldn't measure why it chose what it chose. We rebuilt perception on OpenCV 5, where every decision comes with a number." |
| 3 | 0:45–1:15 | Screen: upload the demo screenshot on `/screenshot`. Pieces appear. Open one "How we matched this" panel. | "OpenCV 5 segments the person into garments with a SegFormer model running in `cv2.dnn`, measures each garment's colors with k-means in Lab space, and classifies it by comparing a CLIP embedding against a garment vocabulary. Each piece becomes a search query, like 'brown felt cowboy hat'." |
| 4 | 1:15–2:00 | Screen: the trace panel for the piece with a retry. Point at the first candidate's scores, the `color_mismatch` reason, the retried query and the second candidate's `match`. | "Then the agent checks its own work. For every product photo it finds, OpenCV segments the garment again and scores it: embedding similarity, CIEDE2000 color distance and a histogram comparison. Here the first hat came back the wrong color. The agent read that reason, put the measured color at the front of the query, searched again, and this one matched. That retry happened because of an OpenCV measurement, not a prompt." |
| 5 | 2:00–2:25 | Screen: a `needs_approval` piece. Click "Use this anyway" (or "Skip piece"). Then add to cart and show the Stripe Checkout page without paying. | "When it can't find a strong match within the time budget, it doesn't pretend. It shows the best weak match with its scores and asks. Nothing goes in the cart, and nothing is bought, until the shopper says so." |
| 6 | 2:25–3:05 | Screen: `architecture.svg`, then the CloudWatch dashboard with this demo's requests. | "The OpenCV service runs in a container on an EC2 Graviton instance behind CloudFront, with the image in ECR, the token in SSM, and every request logged to CloudWatch. The Next.js app on Vercel calls it with image bytes; the service never fetches URLs and never stores images." |
| 7 | 3:05–3:40 | Screen: results table from `report.md`. | "We measured it on our 25 catalog costumes. TODO(numbers): decomposition precision and recall, OpenCV vs the old model; how many pieces matched first try, how many a retry recovered, how many needed approval; and end-to-end latency." |
| 8 | 3:40–4:10 | Screen: `/healthz` showing `"build":"cool"`, then `vision/bench/out/cool.md` if the benchmark has run. | "The service runs on COOL's OpenCV build for Graviton4, and every response says which build served it." Only if `vision/bench/out/cool.md` exists: "On the same instance, COOL ran our workload TODO(numbers) faster than stock OpenCV." Otherwise say nothing about speed. |
| 9 | 4:10–4:35 | Team on camera, or `report.md` limitations section. | "What doesn't work yet: TODO(verify) the two or three failure cases from `eval/out/`. Our evaluation set is 25 generated images we labelled ourselves, so treat the numbers as a first measurement." |
| 10 | 4:35–4:45 | Team on camera, URL on screen. | "It's live at halloween.supply, and the report, diagrams and reproduction steps are in the repo. Thanks." |

## Cut list if you run long

Drop shot 2 to two sentences, then shorten shot 6 to the diagram only. Keep shots 4, 5 and 8 whole: the retry, the approval and the COOL build are the three award claims.
