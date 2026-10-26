#!/usr/bin/env bash
# Bench boxes for Session D. Same family as the service, plus x86 for comparison. No inbound ports; use SSM.
#   ./60-bench-instances.sh up     launch stock-arm (c8g.xlarge Ubuntu), x86 (c7i.xlarge Ubuntu), cool-arm (COOL AMI, if subscribed)
#   ./60-bench-instances.sh down   terminate all of them
#   ./60-bench-instances.sh ls     list them
source "$(dirname "$0")/00-env.sh"

bench_ids() {
  aws ec2 describe-instances --filters "Name=tag:$TAG_KEY,Values=$TAG_VAL" Name=tag:Role,Values=bench \
    Name=instance-state-name,Values=pending,running,stopping,stopped --query 'Reservations[].Instances[].InstanceId' --output text
}

launch() { # name ami type
  [[ -n "$(aws ec2 describe-instances --filters "Name=tag:Name,Values=$NAME-bench-$1" \
    Name=instance-state-name,Values=pending,running --query 'Reservations[].Instances[].InstanceId' --output text)" ]] \
    && { log "$1 already running"; return; }
  local root; root="$(aws ec2 describe-images --image-ids "$2" --query 'Images[0].RootDeviceName' --output text)"
  aws ec2 run-instances --image-id "$2" --instance-type "$3" --security-group-ids "$(sg_id "$BENCH_SG_NAME")" \
    --iam-instance-profile "Name=$PROFILE_NAME" \
    --metadata-options HttpTokens=required,HttpPutResponseHopLimit=1,HttpEndpoint=enabled \
    --block-device-mappings "DeviceName=$root,Ebs={VolumeSize=30,VolumeType=gp3,Encrypted=true,DeleteOnTermination=true}" \
    --instance-initiated-shutdown-behavior terminate \
    --user-data $'#!/bin/bash\napt-get update -y && apt-get install -y docker.io python3-venv unzip\nshutdown -h +240' \
    --tag-specifications "ResourceType=instance,Tags=[{Key=$TAG_KEY,Value=$TAG_VAL},{Key=Role,Value=bench},{Key=Name,Value=$NAME-bench-$1}]" \
      "ResourceType=volume,Tags=[{Key=$TAG_KEY,Value=$TAG_VAL}]" \
    --query 'Instances[0].InstanceId' --output text | xargs -I{} sh -c 'echo "launched {} ('"$1 $3"')" >&2'
}

case "${1:-ls}" in
  up)
    launch stock-arm "$(ubuntu_ami arm64)" "$INSTANCE_TYPE"
    launch x86 "$(ubuntu_ami amd64)" c7i.xlarge
    COOL="$(cool_ami)"
    if [[ -n "$COOL" && "$COOL" != "None" ]]; then launch cool-arm "$COOL" "$INSTANCE_TYPE"
    else log "COOL AMI not available (subscription?); skipped cool-arm"; fi
    log "bench boxes self-terminate after 4 h. Shell: aws ssm start-session --target <id>. Results bucket: s3://$BENCH_BUCKET"
    ;;
  down)
    IDS="$(bench_ids)"; [[ -z "$IDS" ]] && { log "no bench instances"; exit 0; }
    aws ec2 terminate-instances --instance-ids $IDS --query 'TerminatingInstances[].InstanceId' --output text
    ;;
  ls) ;;
  *) echo "usage: $0 up|down|ls" >&2; exit 2 ;;
esac
aws ec2 describe-instances --filters "Name=tag:$TAG_KEY,Values=$TAG_VAL" Name=tag:Role,Values=bench \
  --query 'Reservations[].Instances[].[Tags[?Key==`Name`].Value|[0],InstanceId,InstanceType,State.Name]' --output table
