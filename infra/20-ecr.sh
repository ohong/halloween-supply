#!/usr/bin/env bash
# ECR repository plus the placeholder image (answers /healthz) so the network path can be proven before Session B's image exists.
source "$(dirname "$0")/00-env.sh"

if ! aws ecr describe-repositories --repository-names "$ECR_REPO" >/dev/null 2>&1; then
  aws ecr create-repository --repository-name "$ECR_REPO" --image-scanning-configuration scanOnPush=true \
    --encryption-configuration encryptionType=AES256 --tags "$(tags)" >/dev/null
  log "created ECR repo $ECR_URI"
else log "ECR repo exists: $ECR_URI"; fi

aws ecr get-login-password | docker login --username AWS --password-stdin "${ECR_URI%%/*}" >/dev/null
docker buildx build --platform linux/arm64 -t "$ECR_URI:placeholder" --push "$(dirname "$0")/placeholder"
log "pushed $ECR_URI:placeholder"
