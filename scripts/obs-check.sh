#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm profile `observability` (ADR 0037) sau `make obs-up`, khi lõi đang chạy: Grafana chỉ mở ở 127.0.0.1 và đòi
# đăng nhập, dashboard đã nạp, Prometheus lấy được số liệu của mọi đích và mọi dịch vụ trả lời blackbox, có số liệu
# của cổng, Loki nhận log, và cổng 9080 không trả số liệu. Hỏi Prometheus, Loki và Jaeger qua proxy nguồn dữ liệu của
# Grafana, vì các dịch vụ này không mở cổng ra máy chủ. Số liệu, log và vết tới sau vài chu kỳ lấy, nên mỗi bài được
# thử lại tới khi hết hạn chung.
# Khi cổng đang bật truy vết (MORTISE_TRACING=on, ADR 0038), kiểm thêm: một yêu cầu của user.a qua cổng tới
# workflow-api có vết đủ chặng cổng → workflow-api → Flowable, vết không chứa token, chuỗi truy vấn, user-agent hay tên
# người dùng, và log của cổng trong Loki mang mã vết đó.
# Các hàm kiểm được gọi qua tên truyền cho check(), shellcheck không thấy lời gọi đó.
# shellcheck disable=SC2329
set -euo pipefail
cd "$(dirname "$0")/.."
# .env do `make env` sinh ra và không có trong repo, nên shellcheck không đọc theo.
set -a
# shellcheck source=/dev/null
source .env
set +a

# Cổng mà compose đã mở cho Grafana; GRAFANA_PORT đặt ở môi trường lúc `make obs-up` thì khác giá trị trong .env.
grafana="http://$(docker compose port grafana 3000 2>/dev/null || echo "127.0.0.1:${GRAFANA_PORT:-3000}")"
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

jaeger_healthy() {
  detail=$(api /api/datasources/uid/jaeger/health 2>/dev/null | jq -r .message) || detail="Grafana không hỏi được Jaeger"
  [[ "$detail" == "Data source is working" ]]
}

# Mã vết của yêu cầu thử, đọc từ log truy cập của cổng trong Loki: yêu cầu thật không gửi traceparent, cổng tự sinh mã.
trace_id=""
trace_in_loki() {
  trace_id=$(api /api/datasources/proxy/uid/loki/loki/api/v1/query_range \
    --data-urlencode "query={service=\"apisix\"} |= \"probe=$probe\"" --data-urlencode since=5m 2>/dev/null |
    jq -r '.data.result[].values[][1]' | grep -o 'trace_id=[0-9a-f]\{32\}' | head -1 | cut -d= -f2) || trace_id=""
  detail="chưa thấy dòng log của yêu cầu thử có trace_id"
  [[ -n "$trace_id" ]]
}

# Span server của cổng, span server của workflow-api là con của nó, và span client từ workflow-api tới Flowable.
trace_complete() {
  [[ -n "$trace_id" ]] || { detail="không có mã vết từ bài trước"; return 1; }
  api "/api/datasources/proxy/uid/jaeger/api/traces/$trace_id" >"$trace_file" 2>/dev/null || {
    detail="Jaeger chưa có vết $trace_id"
    return 1
  }
  detail="vết $trace_id thiếu chặng: $(jq -r '.data[0] as $t | ($t.processes | map_values(.serviceName)) as $svc
    | [$t.spans[] | {id: .spanID, svc: $svc[.processID], parent: (.references[0].spanID // ""),
        kind: ([.tags[] | select(.key == "span.kind") | .value][0]),
        peer: ([.tags[] | select(.key == "server.address") | .value][0])}] as $s
    | ([$s[] | select(.svc == "apisix" and .kind == "server") | .id]) as $gw
    | ([$s[] | select(.svc == "workflow-api" and .kind == "server" and (.parent | IN($gw[]))) | .id]) as $wf
    | [if ($gw | length) == 0 then "apisix" else empty end,
       if ($wf | length) == 0 then "workflow-api (con của apisix)" else empty end,
       if ([$s[] | select(.svc == "workflow-api" and .kind == "client" and .peer == "flowable")] | length) == 0
         then "workflow-api → flowable" else empty end] | join(", ")' "$trace_file")"
  [[ "$detail" == "vết $trace_id thiếu chặng: " ]]
}

# Jaeger bỏ chuỗi truy vấn, user-agent, địa chỉ người gọi trước khi lưu; header không bao giờ được ghi (ADR 0038).
trace_clean() {
  local found=() needle
  [[ -s "$trace_file" ]] || { detail="chưa đọc được vết"; return 1; }
  for needle in Bearer "${probe_token##*.}" "?" "$probe" user.a; do
    grep -qF -- "$needle" "$trace_file" && found+=("${needle:0:12}")
  done
  detail="vết chứa: ${found[*]}"
  ((${#found[@]} == 0))
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
check "Grafana đọc được Jaeger" jaeger_healthy

if [[ "$(docker compose exec -T apisix printenv APISIX_TRACE_SAMPLER 2>/dev/null)" == always_on ]]; then
  # Hạn riêng cho các bài vết: yêu cầu thử chỉ gửi lúc này, còn log và vết tới sau vài giây gom lô.
  deadline=$((SECONDS + ${OBS_CHECK_TIMEOUT:-90}))
  trace_file=$(mktemp)
  trap 'rm -f "$trace_file"' EXIT
  # Giá trị ngẫu nhiên vừa là chuỗi truy vấn vừa là user-agent của yêu cầu thử, để biết chắc Jaeger đã bỏ cả hai.
  probe=$(openssl rand -hex 8)
  probe_token=$(curl -fsS "$gateway/auth/realms/mortise/protocol/openid-connect/token" -d grant_type=password \
    -d client_id=mortise-test -d username=user.a --data-urlencode "password=$DEMO_USER_PASSWORD" | jq -r .access_token)
  status=$(curl -s -o /dev/null -w '%{http_code}' -A "obs-check-$probe" -H "Authorization: Bearer $probe_token" \
    "$gateway/v1/workflow/tasks?probe=$probe")
  if [[ "$status" != 200 ]]; then
    echo "FAIL  Yêu cầu thử của user.a tới /v1/workflow/tasks nhận $status (cần make seed)"
    fail=1
  fi
  check "Log của cổng trong Loki mang mã vết của yêu cầu thử" trace_in_loki
  check "Vết của yêu cầu thử đủ chặng apisix → workflow-api → Flowable" trace_complete
  check "Vết không chứa token, chuỗi truy vấn, user-agent hay tên người dùng" trace_clean
else
  echo "BỎ QUA  Vết của yêu cầu qua cổng: truy vết đang tắt (MORTISE_TRACING=off)"
fi

if [[ $fail == 1 ]]; then
  echo "Xem log: docker compose --profile observability logs grafana prometheus loki alloy jaeger" >&2
fi
exit "$fail"
