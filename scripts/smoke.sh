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

base="${MORTISE_PUBLIC_URL:-http://localhost:9080}"
query='{"query":"{ core_tenants { id } }"}'
fail=0

check() {
  if [[ "$2" == "$3" ]]; then echo "PASS  $1"; else echo "FAIL  $1 (muốn: $3, nhận: $2)"; fail=1; fi
}

# Token cho kiểm thử lấy qua client mortise-test do `make seed` tạo; client giao diện không nhận mật khẩu trực tiếp.
token() {
  curl -fsS "$base/auth/realms/mortise/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=mortise-test \
    -d "username=$1" -d "password=$DEMO_USER_PASSWORD" | jq -r .access_token
}

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/v1/graphql" -H 'Content-Type: application/json' -d "$query")
check "API không token bị chặn tại cổng" "$status" 401

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/v1/graphql" \
  -H 'Authorization: Bearer invalid.token.value' -H 'Content-Type: application/json' -d "$query")
check "Token giả bị chặn tại cổng" "$status" 401

status=$(curl -s -o /dev/null -w '%{http_code}' "$base/auth/admin/")
check "Console quản trị Keycloak không lộ qua cổng" "$status" 403

# Cổng chỉ mở các đường OIDC của realm mortise (ADR 0007); mọi đường khác của Keycloak trả 403.
for path in /auth/realms/master/protocol/openid-connect/token /auth/realms/mortise/account/ \
  /auth/realms/mortise/clients-registrations/openid-connect; do
  check "Không lộ qua cổng: $path" "$(curl -s -o /dev/null -w '%{http_code}' "$base$path")" 403
done

check "Khóa công khai (JWKS) của realm lấy được qua cổng" \
  "$(curl -s "$base/auth/realms/mortise/protocol/openid-connect/certs" | jq -r 'has("keys")')" true

# Đăng nhập như trình duyệt (Authorization Code + PKCE) đi trọn qua cổng: trang đăng nhập và tài nguyên của nó,
# gửi form, đổi mã lấy token. Bài này hỏng khi danh sách đường mở ở cổng thiếu một trong các bước đó.
pkce_login() {
  local jar verifier challenge page action assets asset location code
  jar=$(mktemp)
  verifier=$(openssl rand -hex 32)
  challenge=$(printf '%s' "$verifier" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
  page=$(curl -s -c "$jar" -b "$jar" "$base/auth/realms/mortise/protocol/openid-connect/auth?client_id=mortise-web\
&response_type=code&scope=openid&redirect_uri=$base/callback&code_challenge=$challenge&code_challenge_method=S256")
  action=$(grep -o 'action="[^"]*"' <<<"$page" | head -1 | sed -e 's/^action="//' -e 's/"$//' -e 's/&amp;/\&/g')
  # Thiếu tài nguyên (CSS, JS) thì trình duyệt thấy trang đăng nhập vỡ dù form vẫn gửi được.
  assets=$(grep -oE '"/auth/resources/[^"]+\.(css|js)"' <<<"$page" | tr -d '"' || true)
  [[ -n "$assets" ]] || { rm -f "$jar"; return 0; }
  for asset in $assets; do
    [[ "$(curl -s -o /dev/null -w '%{http_code}' "$base$asset")" == 200 ]] || { rm -f "$jar"; return 0; }
  done
  location=$(curl -s -o /dev/null -c "$jar" -b "$jar" -w '%{redirect_url}' --data-urlencode "username=$1" \
    --data-urlencode "password=$DEMO_USER_PASSWORD" "$action")
  rm -f "$jar"
  code=$(sed -n 's/.*[?&]code=\([^&]*\).*/\1/p' <<<"$location")
  curl -s "$base/auth/realms/mortise/protocol/openid-connect/token" -d grant_type=authorization_code \
    -d client_id=mortise-web -d "code=$code" -d "redirect_uri=$base/callback" -d "code_verifier=$verifier" |
    jq -r '.access_token // empty'
}
browser_token=$(pkce_login user.a)
if [[ -n "$browser_token" ]]; then
  tenants=$(curl -s -X POST "$base/v1/graphql" -H "Authorization: Bearer $browser_token" \
    -H 'Content-Type: application/json' -d "$query" | jq -c '[.data.core_tenants[]?.id]')
else
  tenants="không lấy được token"
fi
check "Đăng nhập PKCE qua cổng đi trọn và gọi được API" "$tenants" '["xuong-a"]'

error=$(curl -s "$base/auth/realms/mortise/protocol/openid-connect/token" -d grant_type=password \
  -d client_id=mortise-web -d username=user.a -d "password=$DEMO_USER_PASSWORD" | jq -r .error)
check "Client giao diện không nhận mật khẩu trực tiếp" "$error" unauthorized_client

# Yêu cầu đăng nhập thiếu code_challenge bị Keycloak trả về redirect URI kèm lỗi, không hiện trang đăng nhập.
location=$(curl -s -o /dev/null -w '%{redirect_url}' "$base/auth/realms/mortise/protocol/openid-connect/auth\
?client_id=mortise-web&response_type=code&scope=openid&redirect_uri=$base/callback")
check "Client giao diện bắt buộc PKCE" "$(grep -o 'error=invalid_request' <<<"$location")" error=invalid_request

for pair in "user.a xuong-a" "user.b xuong-b"; do
  read -r user tenant <<<"$pair"
  tenants=$(curl -fsS -X POST "$base/v1/graphql" -H "Authorization: Bearer $(token "$user")" \
    -H 'Content-Type: application/json' -d "$query" | jq -c '[.data.core_tenants[].id]')
  check "$user chỉ thấy dữ liệu tenant của mình" "$tenants" "[\"$tenant\"]"
done

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
