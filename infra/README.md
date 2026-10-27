# Vision service on AWS

The OpenCV vision service runs on one EC2 Graviton4 instance (c8g.xlarge, us-east-1) in Docker, behind a CloudFront distribution that gives it HTTPS. The instance boots from the **Cloud-Optimized OpenCV Library (COOL) Graviton4 AMI**, and the container bind-mounts the host's `/opt/cool` so Session B's `cool` image uses the COOL build of OpenCV. Everything is plain AWS CLI in bash, idempotent, and tagged `Project=halloween-vision`.

```
Vercel app ──HTTPS──> CloudFront (no cache, 60 s timeout) ──HTTP:8080──> EC2 c8g.xlarge (EIP)
                                                                        └ docker: $ECR/halloween-vision:<tag>
                                                                          logs -> CloudWatch /halloween/vision
```

## Prerequisites

- AWS CLI v2 signed in to the target account (`aws sts get-caller-identity` works), Docker with buildx.
- A subscription to the COOL Graviton4 AMI in AWS Marketplace (`prodview-fdvbfiewzuehs`). Without it, `30-instance.sh` falls back to stock Ubuntu 24.04 and only the `stock` / `placeholder` tags run.
- A default VPC in us-east-1.

## Bring it up

Run in order from `infra/`:

1. `./10-network-iam.sh` creates the origin security group (port 8080 from the CloudFront prefix list only), the bench security group (no ingress), the bench S3 bucket, the least-privilege instance role, and the SSM parameters `/halloween/vision/token` (SecureString, random, never overwritten) and `/halloween/vision/image-tag`.
2. `./20-ecr.sh` creates the `halloween-vision` ECR repository and pushes an arm64 `placeholder` image that only answers `/healthz`.
3. `./30-instance.sh` launches the service instance (IMDSv2 only, encrypted gp3, no SSH, Elastic IP) and starts the tag stored in SSM.
4. `./40-cloudfront.sh` creates the distribution and prints its `https://…cloudfront.net` URL (first run waits ~5 min).
5. `./50-observability.sh` sets log retention, metric filters on the JSON request lines, and the `halloween-vision` dashboard.

Deploy a real image after Session B pushes it to ECR:

```bash
./30-instance.sh deploy cool     # or: stock, placeholder
curl -s https://<cloudfront-domain>/healthz
```

`deploy` writes the tag to SSM and runs `/usr/local/bin/vision-run` on the instance through SSM Run Command, which pulls the image, restarts the `vision` container, and waits for `/healthz`. A `cool*` tag adds `-v /opt/cool:/opt/cool:ro -e OPENCV_BUILD=cool -e PYTHONPATH=/opt/cool/python_3.12/site-packages -e LD_LIBRARY_PATH=/opt/cool/cpp_sdk/lib`.

Before the first `cool` deploy, check on the instance (through SSM) that the COOL cv2 imports against the image's numpy 2.x, because a cv2 built against numpy 1.x fails to import under numpy 2:

```bash
docker run --rm -v /opt/cool:/opt/cool:ro -e PYTHONPATH=/opt/cool/python_3.12/site-packages \
  -e LD_LIBRARY_PATH=/opt/cool/cpp_sdk/lib --entrypoint python3 $ECR_URI:cool \
  -c "import cv2, numpy; print(cv2.__file__, cv2.__version__, numpy.__version__)"
```

Shell access is SSM only: `aws ssm start-session --target <instance-id>`.

## Token and Vercel

The bearer token lives in SSM at `/halloween/vision/token`. The container gets it as `VISION_SERVICE_TOKEN`. To wire the app (Oscar runs these):

```bash
aws ssm get-parameter --name /halloween/vision/token --with-decryption --query Parameter.Value --output text
vercel env add VISION_SERVICE_URL production     # paste https://<cloudfront-domain>
vercel env add VISION_SERVICE_TOKEN production   # paste the token
```

## Observability

Each request logs one JSON line (`route`, `status`, `ms`, `n_pieces`, `build`, timings). Metric filters turn those into `Halloween/Vision` metrics `Requests` and `LatencyMs` (by `Route`) and `Errors5xx`; the CloudWatch agent adds `mem_used_percent`. The dashboard shows requests per minute, `/v1/analyze` p50/p95, 5xx, CPU and memory, and a table of recent requests.

## Bench instances (Session D)

```bash
./60-bench-instances.sh up     # stock-arm c8g.xlarge, x86 c7i.xlarge, cool-arm c8g.xlarge (if subscribed)
./60-bench-instances.sh ls
./60-bench-instances.sh down
```

They have no inbound ports, use the same role (SSM, ECR pull, S3 `halloween-vision-bench-<account>`), and power off and terminate themselves 4 h after boot.

## Cost (us-east-1 on-demand, approximate)

| Item | $/hour |
|---|---|
| c8g.xlarge service instance | 0.159 |
| COOL software fee (Graviton4, xlarge) | ~0.01–0.02 |
| Elastic IP (public IPv4) | 0.005 |
| 30 GB gp3 | 0.003 |
| CloudFront, CloudWatch, ECR | cents/day at demo traffic |
| **Service total** | **~0.18** |
| Bench `up` (2× c8g.xlarge + c7i.xlarge) | ~0.50 while running |

Stop the service instance to pause compute cost (`aws ec2 stop-instances`); the EIP keeps the CloudFront origin valid.

## Teardown

`./99-teardown.sh` deletes every resource above after you type `yes`. It keeps the SSM token unless you pass `--all`.
