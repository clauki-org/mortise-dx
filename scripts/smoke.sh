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

# Khai báo bước của quy trình mẫu: đọc được qua GraphQL bằng token, chỉ dòng của tenant mình.
steps_query='{"query":"{ platform_workflow_steps(where: {process: {_eq: \"core-approval\"}}) { tenant_id step config } }"}'
for pair in "user.a xuong-a" "user.b xuong-b"; do
  read -r user tenant <<<"$pair"
  steps=$(curl -fsS -X POST "$base/v1/graphql" -H "Authorization: Bearer $(token "$user")" \
    -H 'Content-Type: application/json' -d "$steps_query" \
    | jq -c '[.data.platform_workflow_steps[] | [.tenant_id, .step, (.config.actions | length)]]')
  check "$user đọc được khai báo bước của tenant mình" "$steps" "[[\"$tenant\",\"review\",2]]"
done

# Quyền Hasura đang chạy phải khớp tệp khai báo (core/hasura/, platform/schema/hasura/); ai sửa tay trên trang quản
# trị thì báo ở đây. Quyền sai thì `make seed` đưa về đúng; bảng hay quan hệ tạo thừa thì thông báo chỉ cách gỡ.
if uv run --quiet --no-project --with pyyaml==6.0.3 python scripts/hasura-metadata.py check; then
  status=khớp
else
  status=lệch
fi
check "Quyền Hasura khớp tệp khai báo" "$status" khớp

# Token thật do Keycloak cấp phải khớp hợp đồng mà các tầng dựa vào.
claims_file=$(mktemp)
trap 'rm -f "$claims_file"' EXIT
payload=$(token manager.a | cut -d. -f2 | tr '_-' '/+')
while (( ${#payload} % 4 )); do payload+="="; done
base64 -d <<<"$payload" > "$claims_file"
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
user_a=$(token user.a)
manager_a=$(token manager.a)
user_b=$(token user.b)
# Người duyệt của tenant khác: cùng vai trò manager, nên không thấy task chỉ có thể vì cách ly tenant.
manager_b=$(token manager.b)

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
check "Nhật ký ghi lần tải tệp với đúng người tải và đơn vị" "$logged" "xuong-a $uploader"
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
  rows=$(sql -c "SELECT count(*) FROM core.files WHERE tenant_id = 'xuong-a'")
  objects=$(docker compose exec -T seaweedfs wget -qO- --header 'Accept: application/json' \
    'http://127.0.0.1:8888/buckets/mortise-files/xuong-a/?limit=100000' | jq '.Entries | length')
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

exit $fail
