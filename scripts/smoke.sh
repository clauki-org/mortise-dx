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
# Người duyệt (manager) phải gửi kèm mã OTP (ADR 0011): token USER [MÃ_OTP].
token() {
  curl -fsS "$base/auth/realms/mortise/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=mortise-test \
    -d "username=$1" -d "password=$DEMO_USER_PASSWORD" ${2:+-d "totp=$2"} | jq -r .access_token
}
# Mã OTP chưa dùng của người duyệt demo; scripts/otp.py chờ sang khung 30 giây mới nếu đã dùng hết mã còn hiệu lực.
otp() { uv run --quiet --no-project python scripts/otp.py next "$1"; }
# Claim của access token, dạng JSON.
claims() {
  local payload
  payload=$(cut -d. -f2 <<<"$1" | tr '_-' '/+')
  while (( ${#payload} % 4 )); do payload+="="; done
  base64 -d <<<"$payload"
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

# Giao diện Tầng 2 đi qua cổng: trang và đường sâu (điều hướng phía trình duyệt) trả index.html kèm CSP; đường sai
# dưới /v1 trả 404 thay vì rơi xuống giao diện.
page_status=$(curl -s -o /dev/null -w '%{http_code}' "$base/some/page")
csp_headers=$(curl -sI "$base/" | grep -ci '^content-security-policy:' || true)
check "Giao diện qua cổng, có Content-Security-Policy" "$page_status $csp_headers" "200 1"
check "Đường API không tồn tại trả 404" "$(curl -s -o /dev/null -w '%{http_code}' "$base/v1/unknown")" 404

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
check "Đăng nhập PKCE qua cổng đi trọn và gọi được API" "$tenants" '["xa-a"]'

error=$(curl -s "$base/auth/realms/mortise/protocol/openid-connect/token" -d grant_type=password \
  -d client_id=mortise-web -d username=user.a -d "password=$DEMO_USER_PASSWORD" | jq -r .error)
check "Client giao diện không nhận mật khẩu trực tiếp" "$error" unauthorized_client

# Yêu cầu đăng nhập thiếu code_challenge bị Keycloak trả về redirect URI kèm lỗi, không hiện trang đăng nhập.
location=$(curl -s -o /dev/null -w '%{redirect_url}' "$base/auth/realms/mortise/protocol/openid-connect/auth\
?client_id=mortise-web&response_type=code&scope=openid&redirect_uri=$base/callback")
check "Client giao diện bắt buộc PKCE" "$(grep -o 'error=invalid_request' <<<"$location")" error=invalid_request

for pair in "user.a xa-a" "user.b xa-b" "user.c xa-c"; do
  read -r user tenant <<<"$pair"
  tenants=$(curl -fsS -X POST "$base/v1/graphql" -H "Authorization: Bearer $(token "$user")" \
    -H 'Content-Type: application/json' -d "$query" | jq -c '[.data.core_tenants[].id]')
  check "$user chỉ thấy dữ liệu tenant của mình" "$tenants" "[\"$tenant\"]"
done

# Tenant cha (ADR 0016): xã biết mình thuộc tỉnh nào; tài khoản của tỉnh với vai trò user chỉ thấy tenant của mình,
# không thấy tenant con. Vai trò rollup_reader không có quyền nào ở bảng của lõi, chỉ đọc view tổng hợp của gói.
parent_query='{"query":"{ core_tenants { id parent_id } }"}'
parent_of() {
  curl -fsS -X POST "$base/v1/graphql" -H "Authorization: Bearer $1" -H "X-Hasura-Role: ${2:-user}" \
    -H 'Content-Type: application/json' -d "$parent_query"
}
check "user.a đọc được tenant cha của mình" "$(parent_of "$(token user.a)" | jq -c '.data.core_tenants')" \
  '[{"id":"xa-a","parent_id":"tinh-mau"}]'
leader=$(token leader.tinh)
check "Tài khoản tỉnh (vai trò user) chỉ thấy tenant của mình, không thấy tenant con" \
  "$(parent_of "$leader" | jq -c '[.data.core_tenants[].id]')" '["tinh-mau"]'
check "Vai trò rollup_reader không đọc được bảng tenant của lõi" \
  "$(parent_of "$leader" rollup_reader | jq -r '.errors[0].extensions.code // "không lỗi"')" validation-failed

# Khai báo bước của quy trình mẫu: đọc được qua GraphQL bằng token, chỉ dòng của tenant mình.
steps_query='{"query":"{ platform_workflow_steps(where: {process: {_eq: \"core-approval\"}}) { tenant_id step config } }"}'
for pair in "user.a xa-a" "user.b xa-b"; do
  read -r user tenant <<<"$pair"
  steps=$(curl -fsS -X POST "$base/v1/graphql" -H "Authorization: Bearer $(token "$user")" \
    -H 'Content-Type: application/json' -d "$steps_query" \
    | jq -c '[.data.platform_workflow_steps[] | [.tenant_id, .step, (.config.actions | length)]]')
  check "$user đọc được khai báo bước của tenant mình" "$steps" "[[\"$tenant\",\"review\",2]]"
done

# Quyền Hasura đang chạy phải khớp tệp khai báo (core/hasura/, platform/schema/hasura/); ai sửa tay trên trang quản
# trị thì báo ở đây. Quyền hay quan hệ sai thì `make seed` đưa về đúng; bảng đăng ký thừa thì thông báo chỉ cách gỡ.
if uv run --quiet --no-project --with pyyaml==6.0.3 python scripts/hasura-metadata.py check; then
  status=khớp
else
  status=lệch
fi
check "Quyền Hasura khớp tệp khai báo" "$status" khớp

# Token thật do Keycloak cấp phải khớp hợp đồng mà các tầng dựa vào.
claims_file=$(mktemp)
trap 'rm -f "$claims_file"' EXIT
# Đăng nhập hai bước của người duyệt (ADR 0011). Chỉ thử sai một lần mỗi tài khoản: Keycloak khóa tạm tài khoản khi
# hai lần sai cách nhau dưới một giây.
error=$(curl -s "$base/auth/realms/mortise/protocol/openid-connect/token" -d grant_type=password \
  -d client_id=mortise-test -d username=manager.b -d "password=$DEMO_USER_PASSWORD" | jq -r .error)
check "Người duyệt chỉ có mật khẩu, thiếu mã OTP, không lấy được token" "$error" invalid_grant
manager_a=$(token manager.a "$(otp manager.a)")
check "Người duyệt có mã OTP lấy được token ghi đã nhập OTP" "$(claims "$manager_a" | jq -c '.amr | sort')" \
  '["otp","pwd"]'
user_a=$(token user.a)
check "Người dùng thường vẫn đăng nhập bằng mật khẩu" "$(claims "$user_a" | jq -c .amr)" '["pwd"]'
claims "$manager_a" > "$claims_file"
if scripts/contracts.sh token "$claims_file"; then status=ok; else status=lệch; fi
check "Token khớp contracts/token-claims.schema.json" "$status" ok

# Flowable chỉ chứa quy trình deploy theo tenant. Hỏi thẳng Flowable ở cổng chỉ mở trong máy
# chủ, vì workflow-api không cho thấy quy trình ngoài tenant của người gọi.
stray=$(curl -fsS -u "rest-admin:$FLOWABLE_ADMIN_PASSWORD" \
  "http://127.0.0.1:${FLOWABLE_PORT:-8083}/flowable-rest/service/repository/process-definitions?size=1000" |
  jq -r '[.data[] | select((.tenantId // "") == "") | .key] | join(",")')
check "Flowable không có quy trình nào ngoài các tenant" "$stray" ""

# Quy trình (Flowable sau workflow-api).
wf="$base/v1/workflow"
user_b=$(token user.b)
# Người duyệt của tenant khác: cùng vai trò manager, nên không thấy task chỉ có thể vì cách ly tenant.
manager_b=$(token manager.b "$(otp manager.b)")

# api METHOD TOKEN PATH [JSON]: in "mã trạng thái<TAB>thân phản hồi".
api() {
  curl -s -X "$1" -H "Authorization: Bearer $2" -H 'Content-Type: application/json' \
    ${4:+-d "$4"} -w '\t%{http_code}' "$wf$3" | awk -F'\t' '{print $NF "\t" $1}'
}

status=$(curl -s -o /dev/null -w '%{http_code}' "$wf/tasks")
check "API quy trình không token bị chặn tại cổng" "$status" 401
# Lỗi 401 của cổng có cùng dạng ErrorBody với lỗi của workflow-api (contracts/workflow-api.openapi.json), để giao
# diện đọc được lý do và biết phải đăng nhập lại.
for path in /v1/workflow/tasks /v1/graphql; do
  response=$(curl -s -X POST -w '\n%{http_code}' "$base$path")
  status=${response##*$'\n'} body=${response%$'\n'*}
  shape=$(jq -r 'if type == "object" and keys == ["error"] then "ErrorBody" else "khác" end' <<<"$body" \
    2>/dev/null || echo "không phải JSON")
  check "Lỗi 401 của $path là JSON theo hợp đồng" "$status $shape" "401 ErrorBody"
done

IFS=$'\t' read -r status body < <(api POST "$user_a" /processes/core-approval/instances \
  '{"variables":{"title":"Kiểm thử đầu-cuối"}}')
check "user.a khởi tạo quy trình duyệt" "$status" 201
instance=$(jq -r .id <<<"$body")

task_of() { api GET "$1" /tasks | cut -f2 | jq -r --arg p "$instance" '.[] | select(.processInstanceId == $p) | .id'; }

check "manager.b (tenant khác, cùng vai trò) không thấy task" "$(task_of "$manager_b")" ""
task=$(task_of "$manager_a")
check "manager.a thấy task cần duyệt" "$([[ -n "$task" ]] && echo yes)" yes
fields=$(api GET "$manager_a" /tasks | cut -f2 \
  | jq -r --arg t "$task" '.[] | select(.id == $t) | "\(.process) \(.step) \(.due != null)"')
check "Task cho biết quy trình, bước và hạn" "$fields" "core-approval review true"

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

# Bấm gửi hai lần gần như cùng lúc với cùng Idempotency-Key: chỉ một quy trình được tạo.
idempotency_key=$(openssl rand -hex 16)
start_once() {
  curl -s -X POST -H "Authorization: Bearer $1" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: $idempotency_key" -d '{"variables":{"title":"Bấm gửi hai lần"}}' \
    "$wf/processes/core-approval/instances" | jq -r .id
}
first=$(mktemp) second=$(mktemp)
start_once "$user_a" > "$first" & start_once "$user_a" > "$second" & wait
created=$(cat "$first")
same=$([[ "$created" =~ ^[0-9a-f-]+$ && "$created" == "$(cat "$second")" ]] && echo yes)
rm -f "$first" "$second"
check "Gửi đồng thời cùng Idempotency-Key trả cùng một quy trình" "$same" yes
check "Gửi lại sau đó với cùng mã vẫn trả quy trình cũ" "$(start_once "$user_a")" "$created"
other=$(start_once "$manager_a")
check "Người khác dùng trùng mã được quy trình của riêng mình" \
  "$([[ "$other" =~ ^[0-9a-f-]+$ && "$other" != "$created" ]] && echo yes)" yes

# Tài khoản dịch vụ (ADR 0017): mở quy trình thay cho tenant ghi ở header, ngoài ra không làm được gì.
token_url="$base/auth/realms/mortise/protocol/openid-connect/token"
service=$(curl -fsS "$token_url" -d grant_type=client_credentials -d client_id=mortise-iot-bridge \
  -d "client_secret=$IOT_BRIDGE_CLIENT_SECRET" | jq -r .access_token)
claims "$service" > "$claims_file"
if scripts/contracts.sh service-token "$claims_file"; then status=ok; else status=lệch; fi
check "Token dịch vụ khớp contracts/service-token-claims.schema.json" "$status" ok
error=$(curl -s "$token_url" -d grant_type=password -d client_id=mortise-iot-bridge \
  -d "client_secret=$IOT_BRIDGE_CLIENT_SECRET" -d username=user.a -d "password=$DEMO_USER_PASSWORD" | jq -r .error)
check "Người dùng không lấy được token mang client dịch vụ, kể cả có secret" "$error" unauthorized_client

# service_start TENANT: id quy trình dịch vụ mở, hoặc mã trạng thái nếu không mở được; cùng một mã chống trùng cho
# cả bài.
service_key="smoke-$(openssl rand -hex 8)"
service_start() {
  curl -s -X POST -H "Authorization: Bearer $service" ${1:+-H "X-Mortise-Tenant: $1"} \
    -H "Idempotency-Key: $service_key" -H 'Content-Type: application/json' \
    -d '{"variables":{"title":"Hồ sơ do dịch vụ mở"}}' -w '\n%{http_code}' "$wf/processes/core-approval/instances" |
    jq -Rrs 'split("\n") | if .[1] == "201" then (.[0] | fromjson | .id) else .[1] end'
}
task_in() { api GET "$1" /tasks | cut -f2 | jq -r --arg p "$2" '.[] | select(.processInstanceId == $p) | .id'; }

opened=$(service_start xa-a)
check "Dịch vụ mở quy trình cho tenant ghi ở header" "$([[ "$opened" =~ ^[0-9a-f-]+$ ]] && echo yes)" yes
check "manager.a thấy việc do dịch vụ mở" "$([[ -n "$(task_in "$manager_a" "$opened")" ]] && echo yes)" yes
check "manager.b (tenant khác) không thấy việc đó" "$(task_in "$manager_b" "$opened")" ""
check "Cùng mã khi quy trình còn mở: không mở thêm" "$(service_start xa-a)" "$opened"
IFS=$'\t' read -r status _ < <(api POST "$manager_a" "/tasks/$(task_in "$manager_a" "$opened")/complete" \
  '{"variables":{"approved":false}}')
check "manager.a xử lý việc do dịch vụ mở" "$status" 204
reopened=$(service_start xa-a)
check "Cùng mã sau khi quy trình đã kết thúc: mở quy trình mới" \
  "$([[ "$reopened" =~ ^[0-9a-f-]+$ && "$reopened" != "$opened" ]] && echo yes)" yes
# Dọn: để bảng việc demo không tích việc do smoke để lại.
api POST "$manager_a" "/tasks/$(task_in "$manager_a" "$reopened")/complete" '{"variables":{"approved":false}}' >/dev/null

check "Dịch vụ thiếu X-Mortise-Tenant bị từ chối" "$(service_start "")" 400
for path in /tasks "/instances/$opened"; do
  status=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $service" -H 'X-Mortise-Tenant: xa-a' \
    "$wf$path")
  check "Dịch vụ chỉ được mở quy trình, không đọc được ${path/$opened/<id>}" "$status" 403
done
status=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $user_a" -H 'X-Mortise-Tenant: xa-b' \
  -H 'Content-Type: application/json' "$wf/processes/core-approval/instances")
check "Người dùng gửi X-Mortise-Tenant bị từ chối" "$status" 400
rows=$(curl -s -X POST -H "Authorization: Bearer $service" -H 'Content-Type: application/json' -d "$query" \
  "$base/v1/graphql" | jq -r '.data.core_tenants // [] | length')
check "Token dịch vụ không đọc được dữ liệu qua Hasura" "$rows" 0
for path in /v1/files/00000000-0000-0000-0000-000000000000 /v1/context/entities; do
  status=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $service" "$base$path")
  check "Token dịch vụ không có tenant nên bị từ chối ở $path" "$status" 403
done

# Tệp (files-api trước SeaweedFS): tải lên, tải xuống đúng nội dung, cách ly tenant, giới hạn cỡ.
files="$base/v1/files"
sample=$(mktemp)
head -c 4096 /dev/urandom >"$sample"
sample_sha=$(sha256sum <"$sample" | cut -d' ' -f1)
response=$(curl -s -X POST -H "Authorization: Bearer $user_a" -H 'Content-Type: application/pdf' \
  --data-binary @"$sample" -w '\n%{http_code}' "$files?name=Bi%C3%AAn%20b%E1%BA%A3n.pdf")
status=${response##*$'\n'} body=${response%$'\n'*}
check "user.a tải tệp lên" "$status $(jq -r .size <<<"$body")" "201 4096"
file_id=$(jq -r .id <<<"$body")
check "Thông tin tệp giữ tên có dấu và băm đúng" "$(jq -r '.name + " " + .sha256' <<<"$body")" "Biên bản.pdf $sample_sha"
downloaded=$(curl -s -H "Authorization: Bearer $user_a" "$files/$file_id/content" | sha256sum | cut -d' ' -f1)
check "Tải xuống đúng nội dung đã tải lên" "$downloaded" "$sample_sha"
uploader=$(jq -r .uploadedBy <<<"$body")
status=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $user_b" "$files/$file_id/content")
check "user.b (tenant khác) không tải được tệp của tenant A" "$status" 404
status=$(curl -s -o /dev/null -w '%{http_code}' "$files/$file_id")
check "API tệp không token bị chặn tại cổng" "$status" 401
# Máy chủ trả 413 rồi đóng kết nối khi curl còn đang gửi, nên curl thoát mã khác 0 dù đã nhận đủ phản hồi.
status=$(head -c $((${FILES_MAX_BYTES:-20971520} + 1)) /dev/zero | curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $user_a" --data-binary @- "$files?name=qua-co.bin" || true)
check "Tệp quá giới hạn cỡ bị từ chối" "$status" 413
rm -f "$sample"

# Nhật ký thay đổi (ADR 0009): ghi đúng người làm, chuỗi băm khớp, và sửa lén thì lệnh kiểm chỉ ra đúng chỗ. Các
# lần sửa lén chạy bằng superuser trong giao dịch rồi ROLLBACK, nên không để lại gì.
sql() { docker compose exec -T postgres psql -qAtX -v ON_ERROR_STOP=1 -U postgres -d mortise "$@"; }
logged=$(sql -c "SELECT tenant_id || ' ' || actor FROM core.audit_log
  WHERE table_name = 'core.files' AND op = 'INSERT' AND row_key ->> 'id' = '$file_id'")
check "Nhật ký ghi lần tải tệp với đúng người tải và đơn vị" "$logged" "xa-a $uploader"
status=$(scripts/audit-verify.sh >/dev/null 2>&1 && echo khớp || echo lệch)
check "Chuỗi băm của nhật ký khớp" "$status" khớp
refused=$(sql -c "UPDATE core.audit_log SET actor = 'sua-len' WHERE id = (SELECT min(id) FROM core.audit_log)" 2>&1 |
  grep -c 'không được phép' || true)
check "Nhật ký không cho sửa, kể cả chủ bảng" "$refused" 1
# Tắt trigger trong giao dịch (chỉ superuser làm được) để giả lập người sửa lén rồi kiểm.
tampered=$(sql <<'SQL'
BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE core.audit_log SET after = after || '{"name": "sua-len.pdf"}' WHERE id = (SELECT min(id) FROM core.audit_log);
SELECT problem FROM core.audit_verify() WHERE id = (SELECT min(id) FROM core.audit_log);
ROLLBACK;
SQL
)
check "Sửa lén một dòng: lệnh kiểm chỉ ra đúng dòng" "$tampered" "nội dung dòng này đã bị sửa"
# Hai lần sửa thật (trigger còn bật) tạo hai dòng nhật ký mới, rồi xóa lén dòng đầu trong hai dòng đó.
broken=$(sql <<SQL
BEGIN;
UPDATE core.files SET name = name WHERE id = '$file_id';
UPDATE core.files SET name = name WHERE id = '$file_id';
SET LOCAL session_replication_role = replica;
DELETE FROM core.audit_log WHERE id = (SELECT id FROM core.audit_log ORDER BY id DESC OFFSET 1 LIMIT 1);
SELECT problem FROM core.audit_verify() WHERE id = (SELECT max(id) FROM core.audit_log);
ROLLBACK;
SQL
)
check "Xóa lén một dòng ở giữa: lệnh kiểm chỉ ra chỗ đứt" "$broken" "chuỗi đứt: thiếu hoặc chèn dòng ngay trước dòng này"
status=$(scripts/audit-verify.sh >/dev/null 2>&1 && echo khớp || echo lệch)
check "Sau các lần thử, nhật ký vẫn nguyên vẹn" "$status" khớp

# Quét mã độc (clamav): tệp thử EICAR bị từ chối và không để lại gì trong CSDL hay kho tệp. Chuỗi EICAR ghép
# từ hai nửa lúc chạy để chính tệp này không bị phần mềm diệt virus trên máy người phát triển nhận là nhiễm.
stored() {
  local rows objects
  rows=$(sql -c "SELECT count(*) FROM core.files WHERE tenant_id = 'xa-a'")
  objects=$(docker compose exec -T seaweedfs wget -qO- --header 'Accept: application/json' \
    'http://127.0.0.1:8888/buckets/mortise-files/xa-a/?limit=100000' | jq '.Entries | length')
  echo "$rows $objects"
}
before=$(stored)
# shellcheck disable=SC2016 # "$" là ký tự của chuỗi thử, không phải biến.
eicar='X5O!P%@AP[4\PZX54(P^)7CC)7}$'
# shellcheck disable=SC2016
eicar+='EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
response=$(printf '%s' "$eicar" | curl -s -X POST -H "Authorization: Bearer $user_a" \
  -H 'Content-Type: text/plain' --data-binary @- -w '\n%{http_code}' "$files?name=eicar.txt")
status=${response##*$'\n'} body=${response%$'\n'*}
check "Tệp thử EICAR bị từ chối kèm tên mẫu nhận diện" \
  "$status $(jq -r '.error | test("Eicar")' <<<"$body")" "422 true"
check "Tệp bị từ chối không để lại dòng trong core.files hay đối tượng trong kho tệp" "$(stored)" "$before"
# Tệp nén lồng 20 tầng, quá MaxRecursion của clamd: với cấu hình mặc định clamd bỏ qua phần sâu hơn và báo sạch;
# compose.yaml bật AlertExceedsMax nên tệp phải bị từ chối.
response=$(uv run --quiet --no-project python -c '
import io, sys, zipfile
data = b"x"
for level in range(20):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr(f"{level}.zip", data)
    data = out.getvalue()
sys.stdout.buffer.write(data)' | curl -s -X POST -H "Authorization: Bearer $user_a" -H 'Content-Type: application/zip' \
  --data-binary @- -w '\n%{http_code}' "$files?name=long-tang.zip")
status=${response##*$'\n'} body=${response%$'\n'*}
check "Tệp nén lồng quá giới hạn quét bị từ chối" \
  "$status $(jq -r '.error | test("Limits.Exceeded")' <<<"$body")" "422 true"
check "Tệp tải lên sau khi quét có trạng thái clean" \
  "$(curl -s -H "Authorization: Bearer $user_a" "$files/$file_id" | jq -r .status)" clean


# Dữ liệu thiết bị (context-api trước Scorpio, ADR 0012): ghi một thiết bị cho xa-a thẳng vào Scorpio
# qua cổng chỉ mở trong máy chủ, như cầu nối MQTT sẽ làm, rồi đọc qua cổng chung bằng token.
context="$base/v1/context/entities"
device=urn:ngsi-ld:Device:smoke-a
# Giá trị mới mỗi lần chạy: bài lịch sử bên dưới phải thấy chính lần ghi này, không phải lần ghi của lần chạy trước.
reading=$((RANDOM % 40 + 41))
status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${SCORPIO_PORT:-9090}/ngsi-ld/v1/entityOperations/upsert" \
  -H 'Content-Type: application/json' -H 'NGSILD-Tenant: xa-a' \
  -d "[{\"id\":\"$device\",\"type\":\"Device\",\"humidity\":{\"type\":\"Property\",\"value\":$reading,\"observedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}}]")
check "Scorpio nhận số đo của thiết bị (cổng máy chủ)" "$([[ $status == 20[14] ]] && echo yes)" yes
seen() { curl -s -H "Authorization: Bearer $1" "${@:2}" "$context?type=Device" | jq -r --arg d "$device" '[.[].id] | index($d) != null'; }
check "user.a đọc được thiết bị của tenant mình qua /v1/context" "$(seen "$user_a")" true
check "user.b (tenant khác) không thấy thiết bị của tenant A" "$(seen "$user_b")" false
check "user.b tự gửi header NGSILD-Tenant của tenant A vẫn không thấy" \
  "$(seen "$user_b" -H 'NGSILD-Tenant: xa-a')" false
status=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $user_b" "$context/$device")
check "user.b đọc thẳng theo mã thiết bị của tenant A nhận 404" "$status" 404
status=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $user_a" "$context?local=false")
check "/v1/context từ chối tham số NGSI-LD ngoài danh sách cho phép" "$status" 400
# Lịch sử số đo (API temporal của NGSI-LD) qua cùng lớp, cùng cách ly tenant. Scorpio ghi lịch sử sau khi đã trả lời
# lệnh ghi (khoảng 2,5 giây, ADR 0018), nên chờ tới khi lần ghi vừa rồi có trong lịch sử, tối đa 15 giây.
history="$base/v1/context/temporal/entities/$device?attrs=humidity&lastN=5"
latest=""
for _ in $(seq 1 30); do
  latest=$(curl -s -H "Authorization: Bearer $user_a" "$history" | jq -c '[.humidity] | flatten | .[0].value' 2>/dev/null || true)
  [[ "$latest" == "$reading" ]] && break
  sleep 0.5
done
check "user.a đọc lịch sử số đo của thiết bị tenant mình" "$latest" "$reading"
check "user.b đọc lịch sử thiết bị của tenant A nhận 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $user_b" "$history")" 404
check "Đọc lịch sử phải giới hạn số lần đo (lastN)" "$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $user_a" "$base/v1/context/temporal/entities/$device?attrs=humidity")" 400
status=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $user_a" -H 'Content-Type: application/json' \
  -d '{}' "$context")
check "/v1/context không nhận ghi" "$([[ $status != 2* ]] && echo yes)" yes
# Đường ngoài /v1 rơi xuống giao diện (trả index.html), nên kiểm nội dung chứ không kiểm mã trạng thái.
leaked=$(curl -s -H "Authorization: Bearer $user_a" "$base/ngsi-ld/v1/entities?type=Device" | grep -c "$device" || true)
check "Scorpio không có đường vào trực tiếp qua cổng" "$leaked" 0


# Số đo qua MQTT (Mosquitto → iot-bridge → Scorpio, ADR 0012): thiết bị demo do `make seed` cấp tài khoản. Lệnh
# gửi chạy trong container Mosquitto vì cổng MQTT không mở ra máy chủ.
# Không dừng smoke khi gửi lỗi: kết quả được kiểm ở bước đọc lại hay bằng mã thoát.
mqtt_pub() { # TÀI_KHOẢN MẬT_KHẨU CHỦ_ĐỀ NỘI_DUNG
  docker compose exec -T mosquitto mosquitto_pub -u "$1" -P "$2" -t "$3" -m "$4" -q 1 2>&1
}
# Chờ thuộc tính $3 của thiết bị $2 (đọc bằng token $1) bằng $4; số đo đi qua cầu nối nên không có ngay.
until_reading() {
  local value
  for _ in $(seq 1 30); do
    value=$(curl -s -H "Authorization: Bearer $1" "$context/urn:ngsi-ld:Device:$2" | jq -r ".$3.value // empty")
    [[ "$value" == "$4" ]] && break
    sleep 0.5
  done
  echo "$value"
}
marker="$((RANDOM % 900 + 100)).5"
mqtt_pub xa-a.archive-01 "$DEMO_DEVICE_PASSWORD" mortise/xa-a/archive-01 'không phải JSON' >/dev/null || true
mqtt_pub xa-a.archive-01 "$DEMO_DEVICE_PASSWORD" mortise/xa-a/archive-01 \
  "{\"measurements\": {\"humidity\": $marker}}" >/dev/null || true
check "Số đo gửi qua MQTT tới được /v1/context của tenant mình (sau một tin hỏng)" \
  "$(until_reading "$user_a" archive-01 humidity "$marker")" "$marker"
# Thiết bị của xa-a gửi vào chủ đề của xa-b: Mosquitto bỏ tin mà không báo lỗi, nên chỉ kết luận sau khi
# một tin hợp lệ gửi sau của xa-b đã tới.
mqtt_pub xa-a.archive-01 "$DEMO_DEVICE_PASSWORD" mortise/xa-b/archive-01 \
  '{"measurements": {"spoofed": 1}}' >/dev/null || true
mqtt_pub xa-b.archive-01 "$DEMO_DEVICE_PASSWORD" mortise/xa-b/archive-01 \
  "{\"measurements\": {\"humidity\": $marker}}" >/dev/null || true
until_reading "$user_b" archive-01 humidity "$marker" >/dev/null
check "Thiết bị không gửi được số đo vào chủ đề của tenant khác" \
  "$(curl -s -H "Authorization: Bearer $user_b" "$context/urn:ngsi-ld:Device:archive-01" | jq 'has("spoofed")')" false
check "MQTT từ chối kết nối không tài khoản" \
  "$(docker compose exec -T mosquitto mosquitto_pub -t mortise/xa-a/archive-01 -m x -q 1 >/dev/null 2>&1 && echo nhận || echo từ-chối)" từ-chối
check "MQTT từ chối mật khẩu sai" \
  "$(mqtt_pub xa-a.archive-01 sai mortise/xa-a/archive-01 x >/dev/null && echo nhận || echo từ-chối)" từ-chối
# Mosquitto vẫn nhận lệnh đăng ký mortise/# của thiết bị nhưng không chuyển tin nào nó không có quyền đọc: kiểm
# rằng tin của thiết bị khác đã tới cầu nối mà thiết bị đăng ký không nhận được.
eavesdrop=$(mktemp)
docker compose exec -T mosquitto mosquitto_sub -u xa-a.archive-01 -P "$DEMO_DEVICE_PASSWORD" \
  -t 'mortise/#' -C 1 -W 6 >"$eavesdrop" 2>/dev/null &
sleep 2
mqtt_pub xa-a.meter-01 "$DEMO_DEVICE_PASSWORD" mortise/xa-a/meter-01 \
  "{\"measurements\": {\"energy\": $marker}}" >/dev/null || true
until_reading "$user_a" meter-01 energy "$marker" >/dev/null
wait
check "Thiết bị không nghe được số đo của thiết bị khác" \
  "$(until_reading "$user_a" meter-01 energy "$marker") $(wc -l <"$eavesdrop")" "$marker 0"
rm -f "$eavesdrop"

# Luật ngưỡng (#89): luật mẫu của lõi (contracts/examples/threshold-rule.example.yaml, `testLevel` > 100 liên tục 5
# giây) mở core-approval cho tenant của thiết bị, qua tài khoản dịch vụ của cầu nối. observedAt do thiết bị gửi, nên
# hai lần đo cách nhau 10 giây gửi ngay được. Không thiết bị demo nào gửi `testLevel`.
# rule_cases TOKEN: các việc đang chờ do luật mẫu mở cho room-101.
rule_cases() {
  api GET "$1" /tasks | cut -f2 | jq -r '.[] | select(.variables.rule == "test-level-high"
    and .variables.ruleApp == "core" and .variables.device == "room-101") | .id'
}
# Đóng việc do lần chạy trước để lại (smoke dừng giữa chừng), để "mở đúng một hồ sơ" không phụ thuộc lần trước.
close_rule_cases() {
  local task
  for task in $(rule_cases "$manager_a"); do
    api POST "$manager_a" "/tasks/$task/complete" '{"variables":{"approved":false}}' >/dev/null
  done
}
level() { # GIÁ_TRỊ GIÂY_LÙI
  mqtt_pub xa-a.room-101 "$DEMO_DEVICE_PASSWORD" mortise/xa-a/room-101 \
    "{\"observedAt\": \"$(date -u -d "-$2 seconds" +%FT%TZ)\", \"measurements\": {\"testLevel\": $1}}" >/dev/null || true
  until_reading "$user_a" room-101 testLevel "$1" >/dev/null
}
until_cases() { # TOKEN SỐ_VIỆC
  local found
  for _ in $(seq 1 20); do
    found=$(rule_cases "$1" | grep -c . || true)
    [[ "$found" == "$2" ]] && break
    sleep 0.5
  done
  echo "$found"
}
close_rule_cases
# Bắt đầu từ một lần đo bình thường: lần chạy trước dừng giữa chừng thì số đo cuối có thể còn vượt ngưỡng.
level 10 11
level 150 10
sleep 2
check "Một lần đo vượt ngưỡng chưa đủ lâu: chưa mở hồ sơ" "$(rule_cases "$manager_a" | grep -c . || true)" 0
level 151 0
check "Vượt ngưỡng liên tục đủ lâu: manager.a có đúng một hồ sơ" "$(until_cases "$manager_a" 1)" 1
check "manager.b (tenant khác) không thấy hồ sơ đó" "$(rule_cases "$manager_b" | grep -c . || true)" 0
level 152 0
sleep 2
check "Vẫn vượt ngưỡng khi hồ sơ còn mở: không mở thêm" "$(rule_cases "$manager_a" | grep -c . || true)" 1
# Dọn: số đo về bình thường rồi đóng hồ sơ, để lần chạy sau bắt đầu từ trạng thái như lần này.
level 10 0
close_rule_cases
check "Đóng hồ sơ xong không còn việc nào của luật mẫu" "$(rule_cases "$manager_a" | grep -c . || true)" 0
# Kho lạnh (ADR 0014): xuất mọi dòng nhật ký tới lúc này sang Parquet; công cụ chỉ ghi nhận đoạn khi băm tính lại
# từ tệp khớp từng dòng, rồi xóa các dòng đó khỏi CSDL trong cùng giao dịch (#97). Sau đó chuỗi băm vẫn phải nối
# qua đoạn đã xóa, ở CSDL (audit-verify) lẫn ở kho lạnh (cold verify), và mọi đường xóa khác vẫn bị chặn.
cold() { docker compose --profile tools run --rm --build --quiet-pull cold-archive "$@" 2>/dev/null; }
# Dòng sẽ được chuyển đi, làm neo như băm cuối ghi trong một bản sao lưu cũ.
cold_anchor=$(sql -c "SELECT id || ':' || encode(hash, 'hex') FROM core.audit_log
  WHERE id > coalesce((SELECT max(last_id) FROM core.audit_segments), 0) ORDER BY id LIMIT 1")
# audit_all gồm mọi đoạn (từ tệp) cộng các dòng trong CSDL sau đoạn cuối; con số này không được đổi khi chuyển.
total=$(sql -c "SELECT (SELECT coalesce(sum(rows), 0) FROM core.audit_segments) + (SELECT count(*)
  FROM core.audit_log WHERE id > coalesce((SELECT max(last_id) FROM core.audit_segments), 0))")
# Bài tải tệp ở trên vừa ghi nhật ký, nên lần xuất này luôn có dòng: chỉ nhận kết quả "đã xóa".
archived=$(cold archive --before "$(date -u -d '+1 minute' +%FT%TZ)" | grep -c 'đã xóa' || true)
check "Xuất nhật ký sang kho lạnh, băm tính lại từ tệp khớp, xóa khỏi CSDL" "$archived" 1
check "Các dòng vừa lưu trữ không còn trong CSDL" "$(sql -c "SELECT count(*) FROM core.audit_log
  WHERE id <= (SELECT max(last_id) FROM core.audit_segments) AND id >= ${cold_anchor%%:*}")" 0
in_all=$(cold query "SELECT count(*) AS n FROM audit_all" | grep -oE '│ +[0-9]+ +│' | tr -dc '0-9')
check "Truy vấn gộp kho lạnh và CSDL vẫn đếm đủ số dòng nhật ký" "$in_all" "$total"
check "Kho lạnh: tính lại chuỗi băm của mọi đoạn từ tệp" "$(cold verify >/dev/null && echo khớp || echo lệch)" khớp
check "Chuỗi băm trong CSDL nối qua đoạn đã xóa" "$(scripts/audit-verify.sh >/dev/null 2>&1 && echo khớp || echo lệch)" khớp
check "Neo của bản sao lưu cũ trỏ vào đoạn đã xóa: đối chiếu qua tệp" \
  "$(scripts/audit-verify.sh "$cold_anchor" >/dev/null 2>&1 && echo khớp || echo lệch)" khớp
# Neo ở giữa đoạn thì đối chiếu qua tệp, neo trùng dòng cuối đoạn (đoạn một dòng) thì qua core.audit_segments; cả hai
# báo "không khớp". Lỗi hạ tầng (không dựng được công cụ, S3 lỗi) không có câu đó nên không được tính là bắt được.
check "Neo sai trỏ vào đoạn đã xóa bị phát hiện" "$(scripts/audit-verify.sh \
  "${cold_anchor%%:*}:$(printf '0%.0s' {1..64})" 2>&1 | grep -q 'không khớp' && echo bắt || echo lọt)" bắt
# Ghi tiếp sau khi đã xóa hết dòng cũ: dòng mới phải nối vào băm cuối của đoạn, không bắt đầu lại chuỗi.
sql -c "UPDATE core.files SET name = name WHERE id = '$file_id'" >/dev/null
check "Dòng ghi sau khi xóa nối vào băm cuối của đoạn" "$(sql -c "SELECT (SELECT prev_hash FROM core.audit_log
  WHERE id > (SELECT max(last_id) FROM core.audit_segments) ORDER BY id LIMIT 1)
  = (SELECT last_hash FROM core.audit_segments ORDER BY last_id DESC LIMIT 1)")" t
check "Ghi sau khi xóa vẫn nối vào chuỗi" "$(scripts/audit-verify.sh >/dev/null 2>&1 && echo khớp || echo lệch)" khớp
# Chủ bảng (hasura, tài khoản của Hasura) cũng không xóa được: xóa thẳng, gọi hàm xóa, hay tự ghi nhận một đoạn
# giả để che dòng đã xóa (đoạn giả làm core.audit_verify nối chuỗi qua chỗ trống).
as_owner() {
  docker compose exec -T -e PGPASSWORD="$HASURA_DB_PASSWORD" postgres \
    psql -qAtX -h 127.0.0.1 -U hasura -d mortise -c "$1" 2>&1 | grep -c 'ADR 0014' || true
}
check "Chủ bảng không xóa thẳng được dòng nhật ký" \
  "$(as_owner 'DELETE FROM core.audit_log WHERE id = (SELECT max(id) FROM core.audit_log)')" 1
check "Không xóa được qua hàm xóa ngoài giao dịch lưu trữ" \
  "$(as_owner 'SELECT core.audit_purge((SELECT max(id) FROM core.audit_segments))')" 1
check "Chủ bảng không ghi nhận được đoạn giả" "$(as_owner "INSERT INTO core.audit_segments (first_id, last_id,
  first_prev, last_hash, rows, object_key, file_sha256) SELECT id, id, prev_hash, hash, 1, 'audit_log/gia.parquet',
  '\\x00' FROM core.audit_log ORDER BY id DESC LIMIT 1")" 1

# Bộ giả lập (devices/simulator) gửi một lượt cho mọi thiết bị demo bằng tài khoản của từng thiết bị: số đo của
# thiết bị xa-a tới được /v1/context của user.a. Mã riêng, khác số đo bài MQTT ở trên đã ghi, để bài này chỉ
# qua khi chính bộ giả lập gửi.
sim_marker="$((RANDOM % 900 + 1000)).25"
if docker compose --profile simulator run --rm --quiet-pull simulator --once \
  --set xa-a/meter-01:energy="$sim_marker" >/dev/null 2>&1; then
  status=chạy
else
  status=lỗi
fi
check "Bộ giả lập gửi được số đo của mọi thiết bị demo" "$status" chạy
check "Số đo của bộ giả lập tới /v1/context" "$(until_reading "$user_a" meter-01 energy "$sim_marker")" "$sim_marker"
demo='["urn:ngsi-ld:Device:archive-01","urn:ngsi-ld:Device:meter-01","urn:ngsi-ld:Device:room-101"]'
check "user.a thấy đủ thiết bị demo của xa-a" \
  "$(curl -s -H "Authorization: Bearer $user_a" "$context?type=Device&limit=100" |
    jq --argjson demo "$demo" '[.[].id] | contains($demo)')" true

exit $fail
