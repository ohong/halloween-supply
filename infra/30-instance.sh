#!/usr/bin/env bash
# Service instance on Graviton (COOL AMI when subscribed, else stock Ubuntu) with an Elastic IP.
#   ./30-instance.sh               launch if missing, print its state
#   ./30-instance.sh deploy <tag>  run ECR tag <tag> (placeholder | stock | cool) on the instance
source "$(dirname "$0")/00-env.sh"

userdata() {
cat <<UD
#!/bin/bash
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get install -y docker.io unzip curl
systemctl enable --now docker
if ! command -v aws; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-\$(uname -m).zip" -o /tmp/awscli.zip
  unzip -q /tmp/awscli.zip -d /tmp && /tmp/aws/install
fi
curl -fsSL https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/arm64/latest/amazon-cloudwatch-agent.deb -o /tmp/cwa.deb
dpkg -i /tmp/cwa.deb
cat > /opt/aws/amazon-cloudwatch-agent/etc/cwa.json <<'CWA'
{"metrics":{"namespace":"$METRIC_NS","append_dimensions":{"InstanceId":"\${aws:InstanceId}"},
 "metrics_collected":{"cpu":{"measurement":["usage_active"],"totalcpu":true},"mem":{"measurement":["used_percent"]}}}}
CWA
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/cwa.json

cat > /usr/local/bin/vision-run <<'RUN'
#!/bin/bash
# Pull and (re)start the vision container. Tag comes from \$1 or SSM $TAG_PARAM.
set -euo pipefail
export AWS_REGION=$AWS_REGION
TAG="\${1:-\$(aws ssm get-parameter --name $TAG_PARAM --query Parameter.Value --output text)}"
TOKEN="\$(aws ssm get-parameter --name $TOKEN_PARAM --with-decryption --query Parameter.Value --output text)"
aws ecr get-login-password | docker login --username AWS --password-stdin ${ECR_URI%%/*}
docker pull $ECR_URI:\$TAG
COOL=()
if [[ "\$TAG" == cool* ]]; then
  [[ -d /opt/cool ]] || { echo "tag \$TAG needs the COOL AMI (/opt/cool missing)"; exit 1; }
  COOL=(-v /opt/cool:/opt/cool:ro -e OPENCV_BUILD=cool
        -e PYTHONPATH=/opt/cool/python_$COOL_PY/site-packages -e LD_LIBRARY_PATH=/opt/cool/cpp_sdk/lib)
fi
docker rm -f vision 2>/dev/null || true
docker run -d --name vision --restart unless-stopped -p 8080:8080 \\
  --log-driver awslogs --log-opt awslogs-region=$AWS_REGION --log-opt awslogs-group=$LOG_GROUP \\
  --log-opt awslogs-stream="\$TAG-\$(hostname)-\$(date +%s)" \\
  -e VISION_SERVICE_TOKEN="\$TOKEN" "\${COOL[@]}" $ECR_URI:\$TAG
for i in \$(seq 1 60); do curl -fsS localhost:8080/healthz && exit 0; sleep 2; done
docker logs --tail 50 vision; exit 1
RUN
chmod +x /usr/local/bin/vision-run
/usr/local/bin/vision-run
UD
}

ID="$(service_instance)"
if [[ "$ID" == "None" || -z "$ID" ]]; then
  AMI="$(cool_ami)"; BUILD=cool
  if [[ "$AMI" == "None" || -z "$AMI" ]]; then
    AMI="$(ubuntu_ami arm64)"; BUILD=stock
    log "COOL AMI not found (not subscribed yet?). Using stock Ubuntu 24.04 arm64 $AMI; relaunch after subscribing."
  fi
  ROOT="$(aws ec2 describe-images --image-ids "$AMI" --query 'Images[0].RootDeviceName' --output text)"
  SUBNET="$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$(default_vpc)" Name=default-for-az,Values=true \
    --query 'Subnets[0].SubnetId' --output text)"
  aws logs create-log-group --log-group-name "$LOG_GROUP" 2>/dev/null && \
    aws logs put-retention-policy --log-group-name "$LOG_GROUP" --retention-in-days 14 || true
  ID="$(aws ec2 run-instances --image-id "$AMI" --instance-type "$INSTANCE_TYPE" --subnet-id "$SUBNET" \
    --security-group-ids "$(sg_id "$SG_NAME")" --iam-instance-profile "Name=$PROFILE_NAME" \
    --metadata-options HttpTokens=required,HttpPutResponseHopLimit=1,HttpEndpoint=enabled \
    --block-device-mappings "DeviceName=$ROOT,Ebs={VolumeSize=30,VolumeType=gp3,Encrypted=true,DeleteOnTermination=true}" \
    --user-data "$(userdata)" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=$TAG_KEY,Value=$TAG_VAL},{Key=Role,Value=service},{Key=Name,Value=$NAME},{Key=Build,Value=$BUILD}]" \
      "ResourceType=volume,Tags=[{Key=$TAG_KEY,Value=$TAG_VAL}]" \
    --query 'Instances[0].InstanceId' --output text)"
  log "launched $ID ($INSTANCE_TYPE, $BUILD AMI $AMI)"
  aws ec2 wait instance-running --instance-ids "$ID"
fi

# Elastic IP keeps the CloudFront origin hostname stable across stop/start.
EIP="$(aws ec2 describe-addresses --filters "Name=tag:$TAG_KEY,Values=$TAG_VAL" --query 'Addresses[0].AllocationId' --output text)"
if [[ "$EIP" == "None" ]]; then
  EIP="$(aws ec2 allocate-address --domain vpc --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=$TAG_KEY,Value=$TAG_VAL}]" \
    --query AllocationId --output text)"
  log "allocated EIP $EIP"
fi
aws ec2 associate-address --instance-id "$ID" --allocation-id "$EIP" >/dev/null

if [[ "${1:-}" == "deploy" ]]; then
  TAG="${2:?usage: 30-instance.sh deploy <tag>}"
  aws ssm put-parameter --name "$TAG_PARAM" --type String --value "$TAG" --overwrite >/dev/null
  CMD="$(aws ssm send-command --instance-ids "$ID" --document-name AWS-RunShellScript \
    --parameters "commands=[\"/usr/local/bin/vision-run $TAG\"]" --query Command.CommandId --output text)"
  log "deploying $TAG (ssm command $CMD)"
  aws ssm wait command-executed --command-id "$CMD" --instance-id "$ID" || true
  aws ssm get-command-invocation --command-id "$CMD" --instance-id "$ID" \
    --query '[Status,StandardOutputContent,StandardErrorContent]' --output text | tail -20
fi

aws ec2 describe-instances --instance-ids "$ID" \
  --query 'Reservations[0].Instances[0].[InstanceId,State.Name,PublicDnsName,Tags[?Key==`Build`].Value|[0]]' --output text
