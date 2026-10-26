#!/usr/bin/env bash
# HTTPS front door: CloudFront -> instance:8080 over HTTP. No caching, all methods, all headers forwarded.
source "$(dirname "$0")/00-env.sh"

CACHING_DISABLED=4135ea2d-6df8-44a3-9df3-4b5a84be39ad
ALL_VIEWER_EXCEPT_HOST=b689b0a8-53d0-40ab-baf2-68738e2966ac

DIST="$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='$NAME'].Id | [0]" --output text)"
if [[ "$DIST" == "None" || -z "$DIST" ]]; then
  ORIGIN="$(aws ec2 describe-instances --instance-ids "$(service_instance)" \
    --query 'Reservations[0].Instances[0].PublicDnsName' --output text)"
  [[ -n "$ORIGIN" && "$ORIGIN" != "None" ]] || { log "service instance has no public DNS; run 30-instance.sh first"; exit 1; }
  cat > /tmp/$NAME-cf.json <<JSON
{
  "CallerReference": "$NAME-$(date +%s)",
  "Comment": "$NAME",
  "Enabled": true,
  "PriceClass": "PriceClass_100",
  "HttpVersion": "http2and3",
  "Origins": {"Quantity": 1, "Items": [{
    "Id": "vision", "DomainName": "$ORIGIN",
    "CustomOriginConfig": {"HTTPPort": 8080, "HTTPSPort": 443, "OriginProtocolPolicy": "http-only",
      "OriginReadTimeout": 60, "OriginKeepaliveTimeout": 5,
      "OriginSslProtocols": {"Quantity": 1, "Items": ["TLSv1.2"]}}
  }]},
  "DefaultCacheBehavior": {
    "TargetOriginId": "vision",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {"Quantity": 7, "Items": ["GET","HEAD","OPTIONS","PUT","PATCH","POST","DELETE"],
      "CachedMethods": {"Quantity": 2, "Items": ["GET","HEAD"]}},
    "CachePolicyId": "$CACHING_DISABLED",
    "OriginRequestPolicyId": "$ALL_VIEWER_EXCEPT_HOST",
    "Compress": true
  }
}
JSON
  DIST="$(aws cloudfront create-distribution-with-tags --distribution-config-with-tags \
    "{\"DistributionConfig\": $(cat /tmp/$NAME-cf.json), \"Tags\": {\"Items\": [{\"Key\": \"$TAG_KEY\", \"Value\": \"$TAG_VAL\"}]}}" \
    --query Distribution.Id --output text)"
  log "created distribution $DIST (origin $ORIGIN); waiting for deploy, ~5 min"
  aws cloudfront wait distribution-deployed --id "$DIST"
fi
DOMAIN="$(aws cloudfront get-distribution --id "$DIST" --query Distribution.DomainName --output text)"
echo "https://$DOMAIN"
