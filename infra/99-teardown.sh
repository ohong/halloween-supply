#!/usr/bin/env bash
# Delete everything these scripts created (tag Project=halloween-vision). Keeps the SSM token unless --all.
source "$(dirname "$0")/00-env.sh"
read -r -p "Tear down all $NAME resources in $ACCOUNT_ID/$AWS_REGION? type yes: " OK; [[ "$OK" == yes ]] || exit 1

DIST="$(aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='$NAME'].Id | [0]" --output text)"
if [[ "$DIST" != "None" && -n "$DIST" ]]; then
  ETAG="$(aws cloudfront get-distribution-config --id "$DIST" --query ETag --output text)"
  aws cloudfront get-distribution-config --id "$DIST" --query DistributionConfig | \
    python3 -c 'import json,sys; c=json.load(sys.stdin); c["Enabled"]=False; print(json.dumps(c))' > /tmp/$NAME-cf-off.json
  aws cloudfront update-distribution --id "$DIST" --if-match "$ETAG" --distribution-config file:///tmp/$NAME-cf-off.json >/dev/null
  log "disabling $DIST (~5 min)"; aws cloudfront wait distribution-deployed --id "$DIST"
  aws cloudfront delete-distribution --id "$DIST" --if-match "$(aws cloudfront get-distribution --id "$DIST" --query ETag --output text)"
fi

IDS="$(aws ec2 describe-instances --filters "Name=tag:$TAG_KEY,Values=$TAG_VAL" \
  Name=instance-state-name,Values=pending,running,stopping,stopped --query 'Reservations[].Instances[].InstanceId' --output text)"
if [[ -n "$IDS" ]]; then aws ec2 terminate-instances --instance-ids $IDS >/dev/null; aws ec2 wait instance-terminated --instance-ids $IDS; fi
for A in $(aws ec2 describe-addresses --filters "Name=tag:$TAG_KEY,Values=$TAG_VAL" --query 'Addresses[].AllocationId' --output text); do
  aws ec2 release-address --allocation-id "$A"; done
for SG in "$SG_NAME" "$BENCH_SG_NAME"; do S="$(sg_id "$SG")"; [[ "$S" != "None" ]] && aws ec2 delete-security-group --group-id "$S"; done

aws cloudwatch delete-dashboards --dashboard-names "$DASHBOARD" || true
aws logs delete-log-group --log-group-name "$LOG_GROUP" || true
aws ecr delete-repository --repository-name "$ECR_REPO" --force >/dev/null || true
aws s3 rb "s3://$BENCH_BUCKET" --force || true

aws iam remove-role-from-instance-profile --instance-profile-name "$PROFILE_NAME" --role-name "$ROLE_NAME" || true
aws iam delete-instance-profile --instance-profile-name "$PROFILE_NAME" || true
for P in AmazonSSMManagedInstanceCore CloudWatchAgentServerPolicy; do
  aws iam detach-role-policy --role-name "$ROLE_NAME" --policy-arn "arn:aws:iam::aws:policy/$P" || true; done
aws iam delete-role-policy --role-name "$ROLE_NAME" --policy-name "$NAME-least" || true
aws iam delete-role --role-name "$ROLE_NAME" || true

aws ssm delete-parameter --name "$TAG_PARAM" || true
[[ "${1:-}" == "--all" ]] && aws ssm delete-parameter --name "$TOKEN_PARAM"
log "teardown done"
