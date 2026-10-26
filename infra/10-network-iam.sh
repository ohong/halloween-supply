#!/usr/bin/env bash
# Security groups, instance role, the service token in SSM, and the bench artifact bucket. Idempotent.
source "$(dirname "$0")/00-env.sh"

VPC_ID="$(default_vpc)"
[[ "$VPC_ID" == "None" ]] && { log "no default VPC in $AWS_REGION; create one with: aws ec2 create-default-vpc"; exit 1; }

# Origin SG: port 8080 only from CloudFront's origin-facing prefix list. No SSH; use Session Manager.
SG="$(sg_id "$SG_NAME")"
if [[ "$SG" == "None" ]]; then
  SG="$(aws ec2 create-security-group --group-name "$SG_NAME" --description "CloudFront to vision service" --vpc-id "$VPC_ID" \
    --tag-specifications "ResourceType=security-group,Tags=[{$(tags | sed 's/ /},{/g')}]" --query GroupId --output text)"
  PL="$(aws ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing \
    --query 'PrefixLists[0].PrefixListId' --output text)"
  aws ec2 authorize-security-group-ingress --group-id "$SG" \
    --ip-permissions "IpProtocol=tcp,FromPort=8080,ToPort=8080,PrefixListIds=[{PrefixListId=$PL,Description=cloudfront}]" >/dev/null
  log "created security group $SG_NAME $SG (8080 from $PL)"
else log "security group $SG_NAME exists: $SG"; fi

# Bench SG: no ingress at all (Session Manager only).
BSG="$(sg_id "$BENCH_SG_NAME")"
if [[ "$BSG" == "None" ]]; then
  BSG="$(aws ec2 create-security-group --group-name "$BENCH_SG_NAME" --description "Bench instances, no ingress" --vpc-id "$VPC_ID" \
    --query GroupId --output text)"
  aws ec2 create-tags --resources "$BSG" --tags "$(tags)"
  log "created security group $BENCH_SG_NAME $BSG"
else log "security group $BENCH_SG_NAME exists: $BSG"; fi

# Bench artifact bucket: bench scripts in, results out.
if ! aws s3api head-bucket --bucket "$BENCH_BUCKET" 2>/dev/null; then
  aws s3api create-bucket --bucket "$BENCH_BUCKET" >/dev/null
  aws s3api put-public-access-block --bucket "$BENCH_BUCKET" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  log "created bucket s3://$BENCH_BUCKET"
else log "bucket s3://$BENCH_BUCKET exists"; fi

# Instance role.
if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE_NAME" --tags "$(tags)" --assume-role-policy-document '{
    "Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  log "created role $ROLE_NAME"
fi
aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name "$NAME-least" --policy-document "$(cat <<JSON
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":"ecr:GetAuthorizationToken","Resource":"*"},
 {"Effect":"Allow","Action":["ecr:BatchGetImage","ecr:GetDownloadUrlForLayer","ecr:BatchCheckLayerAvailability"],
  "Resource":"arn:aws:ecr:$AWS_REGION:$ACCOUNT_ID:repository/$ECR_REPO"},
 {"Effect":"Allow","Action":"ssm:GetParameter",
  "Resource":["arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter$TOKEN_PARAM","arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter$TAG_PARAM"]},
 {"Effect":"Allow","Action":["logs:CreateLogStream","logs:PutLogEvents","logs:DescribeLogStreams"],
  "Resource":"arn:aws:logs:$AWS_REGION:$ACCOUNT_ID:log-group:$LOG_GROUP:*"},
 {"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:ListBucket"],
  "Resource":["arn:aws:s3:::$BENCH_BUCKET","arn:aws:s3:::$BENCH_BUCKET/*"]}
]}
JSON
)"
if ! aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$PROFILE_NAME" --role-name "$ROLE_NAME"
  log "created instance profile $PROFILE_NAME (IAM propagation takes ~10 s)"; sleep 10
fi

# Service token (SecureString, AWS-managed key). Never overwritten once set.
if ! aws ssm get-parameter --name "$TOKEN_PARAM" >/dev/null 2>&1; then
  aws ssm put-parameter --name "$TOKEN_PARAM" --type SecureString --value "$(openssl rand -hex 32)" >/dev/null
  log "created SecureString $TOKEN_PARAM"
else log "token $TOKEN_PARAM exists"; fi
aws ssm get-parameter --name "$TAG_PARAM" >/dev/null 2>&1 || \
  aws ssm put-parameter --name "$TAG_PARAM" --type String --value placeholder >/dev/null

log "done: vpc=$VPC_ID sg=$SG bench_sg=$BSG role=$ROLE_NAME bucket=$BENCH_BUCKET"
