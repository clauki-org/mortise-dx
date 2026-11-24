#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm profile `observability` (ADR 0037) sau `make obs-up`, khi lõi đang chạy: Grafana chỉ mở ở 127.0.0.1 và đòi
# đăng nhập, dashboard đã nạp, Prometheus lấy được số liệu của mọi đích và mọi dịch vụ trả lời blackbox, có số liệu
# của cổng, Loki nhận log, và cổng 9080 không trả số liệu. Hỏi Prometheus và Loki qua proxy nguồn dữ liệu của Grafana,
# vì hai dịch vụ này không mở cổng ra máy chủ. Số liệu và log tới sau vài chu kỳ lấy, nên mỗi bài được thử lại tới khi
# hết hạn chung.
# Các hàm kiểm được gọi qua tên truyền cho check(), shellcheck không thấy lời gọi đó.
# shellcheck disable=SC2329
set -euo pipefail
cd "$(dirname "$0")/.."
# .env do `make env` sinh ra và không có trong repo, nên shellcheck không đọc theo.
set -a
# shellcheck source=/dev/null
source .env
set +a

grafana="http://127.0.0.1:${GRAFANA_PORT:-3000}"
gateway="${MORTISE_PUBLIC_URL:-http://localhost:9080}"
# Hạn chung cho mọi bài, giây: Prometheus lấy số liệu mỗi 15 giây, APISIX làm mới số liệu theo chu kỳ riêng.
deadline=$((SECONDS + ${OBS_CHECK_TIMEOUT:-90}))
fail=0
detail=""

api() { curl -fsS -u "admin:$GRAFANA_ADMIN_PASSWORD" -G "$grafana$1" "${@:2}"; }
prom() { api /api/datasources/proxy/uid/prometheus/api/v1/query --data-urlencode "query=$1"; }

# Thử lại bài $2.. tới khi qua hoặc hết hạn chung; bài trượt ghi lý do vào biến detail.
check() {
  local name=$1
  shift
  detail=""
  until "$@"; do
    if ((SECONDS >= deadline)); then
      echo "FAIL  $name${detail:+ ($detail)}"
      fail=1
      return 0
    fi
    sleep 3
  done
  echo "PASS  $name"
}

grafana_healthy() { [[ "$(curl -fsS "$grafana/api/health" 2>/dev/null | jq -r .database)" == ok ]]; }

anonymous_refused() {
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' "$grafana/api/dashboards/uid/mortise-overview")
  detail="nhận $status"
  [[ "$status" == 401 ]]
}

dashboard_loaded() {
  local title
  title=$(api /api/dashboards/uid/mortise-overview 2>/dev/null | jq -r .dashboard.title) || title=""
  detail="đăng nhập admin bằng GRAFANA_ADMIN_PASSWORD trong .env; mật khẩu chỉ áp dụng khi volume grafanadata còn trống"
  [[ -n "$title" && "$title" != null ]]
}

targets_up() {
  local down
  down=$(api /api/datasources/proxy/uid/prometheus/api/v1/targets 2>/dev/null |
    jq -r '[.data.activeTargets[] | select(.health != "up") | "\(.labels.job)/\(.labels.service)"] | join(" ")') ||
    down="không hỏi được Prometheus"
  detail="chưa lấy được: $down"
  [[ -z "$down" ]]
}

probes_succeed() {
  local failed
  failed=$(prom probe_success 2>/dev/null |
    jq -r 'if (.data.result | length) == 0 then "chưa có kết quả"
      else [.data.result[] | select(.value[1] != "1") | .metric.service] | join(" ") end') ||
    failed="không hỏi được Prometheus"
  detail="không trả lời: $failed"
  [[ -z "$failed" ]]
}

gateway_series() {
  [[ "$(prom 'apisix_http_status{route="graphql"}' 2>/dev/null | jq '.data.result | length')" -gt 0 ]]
}

loki_has_logs() {
  local lines
  lines=$(api /api/datasources/proxy/uid/loki/loki/api/v1/query_range --data-urlencode 'query={service="apisix"}' \
    --data-urlencode since=5m --data-urlencode limit=1 2>/dev/null | jq '[.data.result[].values[]] | length') ||
    lines=0
  [[ "$lines" -ge 1 ]]
}

# Cổng 9080 chuyển mọi đường không khớp API về giao diện (trả index.html với mã 200), nên kiểm nội dung, không kiểm mã.
metrics_hidden() {
  local body
  body=$(curl -s -w '\n%{http_code}' "$gateway/apisix/prometheus/metrics")
  detail="cổng trả ${body##*$'\n'}"
  [[ "${body##*$'\n'}" != 000 ]] && ! grep -q '^apisix_' <<<"$body"
}

grafana_local_only() {
  local bound
  bound=$(docker compose port grafana 3000 2>/dev/null) || bound=""
  detail="nhận '$bound'"
  [[ "$bound" == 127.0.0.1:* ]]
}

# Một yêu cầu không token qua cổng để route graphql chắc chắn có số liệu, kể cả khi chưa ai gọi API.
curl -s -o /dev/null "$gateway/v1/graphql" || true

check "Grafana chạy" grafana_healthy
check "Grafana chỉ mở ở 127.0.0.1" grafana_local_only
check "Grafana từ chối yêu cầu không đăng nhập" anonymous_refused
check "Dashboard mortise-overview đã nạp" dashboard_loaded
check "Cổng 9080 không trả số liệu Prometheus" metrics_hidden
check "Prometheus lấy được số liệu của mọi đích" targets_up
check "Mọi dịch vụ trả lời blackbox" probes_succeed
check "Có số liệu của route graphql ở cổng" gateway_series
check "Loki nhận log của apisix trong 5 phút qua" loki_has_logs

if [[ $fail == 1 ]]; then
  echo "Xem log: docker compose --profile observability logs grafana prometheus loki alloy" >&2
fi
exit "$fail"
