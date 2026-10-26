# Devpost submission

Paste each section into the matching Devpost field. Numbers here must match [report.md](report.md); if one changes there, change it here.

## Project name

halloween.supply

## Tagline

Show it a costume photo; OpenCV 5 finds each piece at real shops, checks every product photo, and searches again when the match is wrong.

## Links

- Live demo: https://halloween.supply/screenshot
- Video: TODO(Oscar): video URL
- Code: TODO(Oscar): repository URL. The repository is private today; judges need access or a public copy.
- Report: `docs/opencv-competition/report.md` in the repository

## Featured paths

**Agentic Vision.** OpenCV measurements decide the agent's next action. For each garment, `/v1/match` returns a verdict and machine-readable reasons (`color_mismatch`, `type_mismatch`, `no_garment`), and one table-driven function, `decideNext`, turns those into a different next step: search again with the measured color first, search with the next garment type, search with an alternate phrasing, or stop and ask the shopper to approve a weak match. Every step is traced and shown to the shopper in a "How we matched this" panel. Evidence: report section 7, the agent loop diagram, a recorded trace with a retry in `eval/traces/` TODO(verify), and the loop results in `eval/out/agent.md` TODO(numbers).

**Best Use of COOL.** The vision service runs on an EC2 Graviton4 instance from the Cloud Optimized OpenCV for AWS Graviton4 AMI, with COOL's OpenCV mounted into the service container, and every response reports which build served it in an `X-OpenCV-Build` header and on `/healthz`. We benchmarked the same workload with COOL on Graviton, stock `opencv-python-headless==5.0.0.93` on the same instance type, and stock on x86 `c7i.xlarge`, and recorded `cv2.getBuildInformation()` for each run. Evidence: report section 6 and `vision/bench/out/cool.md` TODO(numbers).

## About the project

### Inspiration

Costume ideas arrive as pictures, and buying one means turning a picture of a person into a shopping list, then checking dozens of product photos by eye. Our store already did this with two calls to a multimodal language model, but it gave us judgments without measurements, so the system had nothing to act on when a match was wrong.

### What it does

You upload a screenshot of a costume. An OpenCV 5 service segments the person into garments, measures each garment's colors, classifies it against a garment vocabulary, and writes a search query for it. The store searches independent merchants, sends the product photos back to OpenCV to be scored, and an agent loop reads the scores: it accepts a strong match, searches again with a corrected query when the color or garment type is wrong, and asks you before using a weak match. You see the evidence for every choice, add the pieces to a cart, and pay through Stripe Checkout.

### How we built it

- **Perception:** a FastAPI service where every image operation runs through OpenCV 5. SegFormer-B2 clothes parsing and the CLIP ViT-B/32 image encoder run in `cv2.dnn` from ONNX files; colors come from k-means in Lab space named against a retail color table; product photos are segmented with the same model or with GrabCut, then scored with CLIP similarity, CIEDE2000 color distance and `compareHist`.
- **Agent:** the Next.js route on Vercel runs one perceive, search, re-perceive, decide loop per garment inside a 30-second budget, and streams its trace to the browser.
- **Cloud:** EC2 Graviton4 with COOL, behind CloudFront, image in ECR, token in SSM Parameter Store, logs and a dashboard in CloudWatch, all created by numbered AWS CLI scripts with a teardown script.
- **Evaluation:** the 25 catalog costumes with hand-checked ground-truth component lists, OpenCV against the previous language-model path, plus the COOL benchmark.

### Challenges we ran into

TODO(Oscar): one or two real challenges from tonight. Candidates from the build notes: the COOL Docker listing only meters on ECS or EKS, so we used the COOL AMI and mounted its OpenCV into our container; the catalog images are ghost-mannequin renders with transparent backgrounds that decode to black, so the evaluation flattens them onto white first.

### Accomplishments we're proud of

TODO(numbers): one sentence each on the retry recovery rate and the COOL speedup, from `eval/out/agent.md` and `vision/bench/out/cool.md`.

### What we learned

Measurable perception changes what an agent can do. Once a match comes back as "right garment, wrong color, ΔE 31", the next search can fix the color, and the shopper can see why. A yes or no from a model gives the loop nothing to work with.

### What's next

- A larger evaluation set of real screenshots, measured across skin tones, body types and lighting.
- Costume-specific garment classes (capes, wings, masks) that clothes parsing does not label today.
- Per-request authentication for the vision service if it is used beyond this storefront.

## Built with

OpenCV 5, cv2.dnn, ONNX, SegFormer, CLIP, Python, FastAPI, uv, AWS, Amazon EC2 (Graviton4), COOL (Cloud Optimized OpenCV for AWS Graviton), Amazon CloudFront, Amazon ECR, AWS Systems Manager Parameter Store, Amazon CloudWatch, Docker, Next.js, TypeScript, Bun, Vercel, Firecrawl, Turso, Stripe

## Team

TODO(Oscar): names and roles.
