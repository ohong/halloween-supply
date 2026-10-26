#!/usr/bin/env bash
# Log group, metric filters on the JSON request lines, and the dashboard.
source "$(dirname "$0")/00-env.sh"

aws logs create-log-group --log-group-name "$LOG_GROUP" 2>/dev/null && log "created log group $LOG_GROUP" || true
aws logs put-retention-policy --log-group-name "$LOG_GROUP" --retention-in-days 14

# One JSON line per request: {"route","status","ms","n_pieces","build",...}
mf() { # name pattern metric value [dimensions-json]
  local t="{\"metricName\":\"$3\",\"metricNamespace\":\"$METRIC_NS\",\"metricValue\":\"$4\",\"unit\":\"${6:-None}\"${5:+,\"dimensions\":$5}}"
  aws logs put-metric-filter --log-group-name "$LOG_GROUP" --filter-name "$1" \
    --filter-pattern "$2" --metric-transformations "$t"
}
mf requests     '{ $.ms >= 0 }'     Requests  1    '{"Route":"$.route"}' Count
mf latency      '{ $.ms >= 0 }'     LatencyMs '$.ms' '{"Route":"$.route"}' Milliseconds
mf errors-5xx   '{ $.status >= 500 }'             Errors5xx 1    '' Count
log "metric filters set in $METRIC_NS"

ID="$(service_instance)"
R="$AWS_REGION"
cat > /tmp/$NAME-dash.json <<JSON
{"widgets":[
 {"type":"metric","x":0,"y":0,"width":12,"height":6,"properties":{"title":"Requests / min by route","region":"$R","stat":"Sum","period":60,"view":"timeSeries",
  "metrics":[[{"expression":"SEARCH('{$METRIC_NS,Route} MetricName=\"Requests\"', 'Sum', 60)","id":"r","label":""}]]}},
 {"type":"metric","x":12,"y":0,"width":12,"height":6,"properties":{"title":"/v1/analyze latency (ms)","region":"$R","period":60,"view":"timeSeries",
  "metrics":[["$METRIC_NS","LatencyMs","Route","/v1/analyze",{"stat":"p50","label":"p50"}],["...",{"stat":"p95","label":"p95"}]]}},
 {"type":"metric","x":0,"y":6,"width":12,"height":6,"properties":{"title":"5xx / min","region":"$R","stat":"Sum","period":60,
  "metrics":[["$METRIC_NS","Errors5xx"]]}},
 {"type":"metric","x":12,"y":6,"width":12,"height":6,"properties":{"title":"Service instance CPU / memory %","region":"$R","period":60,"stat":"Average",
  "metrics":[["AWS/EC2","CPUUtilization","InstanceId","$ID",{"label":"CPU"}],["$METRIC_NS","mem_used_percent","InstanceId","$ID",{"label":"Memory"}]]}},
 {"type":"log","x":0,"y":12,"width":24,"height":6,"properties":{"title":"Recent requests","region":"$R",
  "query":"SOURCE '$LOG_GROUP' | fields @timestamp, route, status, ms, n_pieces, build | filter ispresent(route) | sort @timestamp desc | limit 50","view":"table"}}
]}
JSON
aws cloudwatch put-dashboard --dashboard-name "$DASHBOARD" --dashboard-body "file:///tmp/$NAME-dash.json" >/dev/null
echo "https://$R.console.aws.amazon.com/cloudwatch/home?region=$R#dashboards/dashboard/$DASHBOARD"
