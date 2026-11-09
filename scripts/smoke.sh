#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm tra đầu-cuối qua cổng APISIX: zero-trust, SSO và cách ly tenant.
set -euo pipefail
cd "$(dirname "$0")/.."
# .env do `make env` sinh ra và không có trong repo, nên shellcheck không đọc theo.
set -a
# shellcheck source=/dev/null
source .env
set +a

base="${DXOS_PUBLIC_URL:-http://localhost:9080}"
query='{"query":"{ core_tenants { id } }"}'
fail=0

check() {
  if [[ "$2" == "$3" ]]; then echo "PASS  $1"; else echo "FAIL  $1 (muốn: $3, nhận: $2)"; fail=1; fi
}

token() {
  curl -fsS "$base/auth/realms/dxos/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=dxos-web \
    -d "username=$1" -d "password=$DEMO_USER_PASSWORD" | jq -r .access_token
}

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/v1/graphql" -H 'Content-Type: application/json' -d "$query")
check "API không token bị chặn tại cổng" "$status" 401

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/v1/graphql" \
  -H 'Authorization: Bearer invalid.token.value' -H 'Content-Type: application/json' -d "$query")
check "Token giả bị chặn tại cổng" "$status" 401

status=$(curl -s -o /dev/null -w '%{http_code}' "$base/auth/admin/")
check "Console quản trị Keycloak không lộ qua cổng" "$status" 403

for pair in "user.a xuong-a" "user.b xuong-b"; do
  read -r user tenant <<<"$pair"
  tenants=$(curl -fsS -X POST "$base/v1/graphql" -H "Authorization: Bearer $(token "$user")" \
    -H 'Content-Type: application/json' -d "$query" | jq -c '[.data.core_tenants[].id]')
  check "$user chỉ thấy dữ liệu tenant của mình" "$tenants" "[\"$tenant\"]"
done

# Token thật do Keycloak cấp phải khớp hợp đồng mà các tầng dựa vào.
claims_file=$(mktemp)
trap 'rm -f "$claims_file"' EXIT
payload=$(token manager.a | cut -d. -f2 | tr '_-' '/+')
while (( ${#payload} % 4 )); do payload+="="; done
base64 -d <<<"$payload" > "$claims_file"
if uvx --from check-jsonschema==0.29.4 check-jsonschema -q \
  --schemafile contracts/token-claims.schema.json "$claims_file"; then status=ok; else status=lệch; fi
check "Token khớp contracts/token-claims.schema.json" "$status" ok

# Quy trình (Flowable sau workflow-api).
wf="$base/v1/workflow"
user_a=$(token user.a)
manager_a=$(token manager.a)
user_b=$(token user.b)

# api METHOD TOKEN PATH [JSON]: in "mã trạng thái<TAB>thân phản hồi".
api() {
  curl -s -X "$1" -H "Authorization: Bearer $2" -H 'Content-Type: application/json' \
    ${4:+-d "$4"} -w '\t%{http_code}' "$wf$3" | awk -F'\t' '{print $NF "\t" $1}'
}

status=$(curl -s -o /dev/null -w '%{http_code}' "$wf/tasks")
check "API quy trình không token bị chặn tại cổng" "$status" 401

IFS=$'\t' read -r status body < <(api POST "$user_a" /processes/core-approval/instances \
  '{"variables":{"title":"Kiểm thử đầu-cuối"}}')
check "user.a khởi tạo quy trình duyệt" "$status" 201
instance=$(jq -r .id <<<"$body")

task_of() { api GET "$1" /tasks | cut -f2 | jq -r --arg p "$instance" '.[] | select(.processInstanceId == $p) | .id'; }

check "user.b (tenant khác) không thấy task" "$(task_of "$user_b")" ""
task=$(task_of "$manager_a")
check "manager.a thấy task cần duyệt" "$([[ -n "$task" ]] && echo yes)" yes

IFS=$'\t' read -r status _ < <(api POST "$user_a" "/tasks/$task/complete" '{"variables":{"approved":true}}')
check "user.a (không có vai trò manager) không duyệt được" "$status" 403

IFS=$'\t' read -r status _ < <(api POST "$user_b" "/tasks/$task/complete" '{"variables":{"approved":true}}')
check "user.b (tenant khác) không duyệt được" "$status" 404

IFS=$'\t' read -r status _ < <(api POST "$manager_a" "/tasks/$task/complete" '{"variables":{"approved":true}}')
check "manager.a duyệt yêu cầu" "$status" 204

IFS=$'\t' read -r status body < <(api GET "$user_a" "/instances/$instance")
check "Quy trình kết thúc ở nhánh đã duyệt" "$(jq -r '.outcome' <<<"$body")" approved

IFS=$'\t' read -r _ body < <(api POST "$manager_a" /processes/core-approval/instances \
  '{"variables":{"title":"Tự gửi tự duyệt"}}')
instance=$(jq -r .id <<<"$body")
IFS=$'\t' read -r status body < <(api POST "$manager_a" "/tasks/$(task_of "$manager_a")/complete" \
  '{"variables":{"approved":true}}')
check "Quy tắc bốn mắt: người gửi không tự duyệt được" "$status" 403

IFS=$'\t' read -r status _ < <(api POST "$user_a" /processes/core-approval/instances \
  '{"variables":{"initiator":"gia-mao"}}')
check "Không ghi đè được biến dành riêng của lõi" "$status" 400

exit $fail
