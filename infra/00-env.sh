#!/usr/bin/env bash
# Shared names for every infra script. Source it; do not run it.
set -euo pipefail

export AWS_REGION="${AWS_REGION:-us-east-2}"
export AWS_DEFAULT_REGION="$AWS_REGION"
export AWS_PAGER=""

NAME="halloween-vision"
TAG_KEY="Project"
TAG_VAL="$NAME"

INSTANCE_TYPE="${INSTANCE_TYPE:-c8g.xlarge}"
ROLE_NAME="$NAME-ec2"
PROFILE_NAME="$NAME-ec2"
SG_NAME="$NAME-origin"
BENCH_SG_NAME="$NAME-bench"
ECR_REPO="$NAME"
LOG_GROUP="/halloween/vision"
TOKEN_PARAM="/halloween/vision/token"
TAG_PARAM="/halloween/vision/image-tag"   # which ECR tag the instance runs
METRIC_NS="Halloween/Vision"
DASHBOARD="$NAME"

# COOL Graviton4 AMI (Marketplace prodview-fdvbfiewzuehs). Name filter is used to find it after subscribing.
COOL_AMI_NAME="${COOL_AMI_NAME:-*Cloud*Optimized*OpenCV*Graviton*4*}"
COOL_PY="3.12"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ECR_URI="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO"
BENCH_BUCKET="$NAME-bench-$ACCOUNT_ID"

tags() { echo "Key=$TAG_KEY,Value=$TAG_VAL" "$@"; }
log() { printf '\033[1;36m[%s]\033[0m %s\n' "$(basename "$0")" "$*" >&2; }

default_vpc() { aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text; }
sg_id() { aws ec2 describe-security-groups --filters "Name=group-name,Values=$1" --query 'SecurityGroups[0].GroupId' --output text; }
service_instance() {
  aws ec2 describe-instances --filters "Name=tag:$TAG_KEY,Values=$TAG_VAL" Name=tag:Role,Values=service \
    Name=instance-state-name,Values=pending,running,stopping,stopped \
    --query 'Reservations[].Instances[0].InstanceId' --output text | awk '{print $1}'
}
ubuntu_ami() { # $1 = arm64 | amd64
  aws ssm get-parameter --name "/aws/service/canonical/ubuntu/server/24.04/stable/current/$1/hvm/ebs-gp3/ami-id" \
    --query Parameter.Value --output text
}
cool_ami() {
  aws ec2 describe-images --owners aws-marketplace --filters "Name=name,Values=$COOL_AMI_NAME" Name=architecture,Values=arm64 \
    --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text
}
