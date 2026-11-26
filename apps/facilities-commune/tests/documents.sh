#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Giấy tờ đính kèm cơ sở qua cổng (ADR 0041), gọi từ tests/smoke.sh: cán bộ phụ trách tải tệp lên /v1/files rồi
# thêm dòng nối, tenant và người đính kèm lấy từ token; người duyệt cùng xã được phân công thấy và tải được tệp nhưng
# không đính kèm được; xã B không thấy dòng nối và nhận 404 với mã tệp; tệp thử EICAR bị từ chối và không có dòng
# nối nào; dòng nối không sửa, không xóa được, có nhật ký. Tự tạo và tự dọn cơ sở thử, chạy lại nhiều lần không lỗi.
#
# SC2016: biến GraphQL ($f, $id) nằm trong nháy đơn để shell không mở rộng; giá trị đi qua trường variables.
# shellcheck disable=SC2016
set -euo pipefail
cd "$(dirname "$0")/../../.."
set -a
# shellcheck source=/dev/null
source .env
set +a

base="${MORTISE_PUBLIC_URL:-http://localhost:9080}"
files="$base/v1/files"
admin=tenant_admin
fail=0

check() {
  if [[ "$2" == "$3" ]]; then echo "PASS  $1"; else echo "FAIL  $1 (muốn: $3, nhận: $2)"; fail=1; fi
}
token() {
  curl -fsS "$base/auth/realms/mortise/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=mortise-test \
    -d "username=$1" -d "password=$DEMO_USER_PASSWORD" ${2:+-d "totp=$2"} | jq -r .access_token
}
gql() {
  jq -cn --arg q "$2" --argjson v "${3:-{\}}" '{query: $q, variables: $v}' |
    curl -fsS -X POST "$base/v1/graphql" -H "Authorization: Bearer $1" -H "X-Hasura-Role: ${4:-user}" \
      -H 'Content-Type: application/json' -d @-
}
sub_of() {
  local payload
  payload=$(cut -d. -f2 <<<"$1" | tr '_-' '/+')
  while (( ${#payload} % 4 )); do payload+="="; done
  base64 -d <<<"$payload" | jq -r .sub
}
errors() { jq 'has("errors")' <<<"$1"; }
# upload TOKEN TÊN KIỂU: nội dung ở stdin; in "<mã HTTP> <thân phản hồi>".
upload() {
  local response
  response=$(curl -s -X POST -H "Authorization: Bearer $1" -H "Content-Type: $3" --data-binary @- \
    -w '\n%{http_code}' "$files?name=$2")
  echo "${response##*$'\n'} ${response%$'\n'*}"
}

user_a=$(token user.a)
user_b=$(token user.b)
admin_a=$(token admin.a)
manager_a=$(token manager.a "$(uv run --quiet --no-project python scripts/otp.py next manager.a)")
code="smoke-doc-$(date +%s)-$RANDOM"

facility=$(gql "$admin_a" 'mutation($code: String!) { insert_app_facilities_commune_facilities_one(
  object: {code: $code, name: "Trụ sở UBND xã A (kiểm thử giấy tờ)"}) { id } }' "{\"code\":\"$code\"}" "$admin" |
  jq -r '.data.insert_app_facilities_commune_facilities_one.id')
assign='mutation($f: uuid!, $u: String!, $d: String!) {
  insert_app_facilities_commune_facility_assignments_one(object: {facility_id: $f, user_id: $u, duty: $d}) { id } }'
gql "$admin_a" "$assign" "{\"f\":\"$facility\",\"u\":\"$(sub_of "$user_a")\",\"d\":\"custodian\"}" "$admin" >/dev/null
# Người duyệt xã A đọc danh mục bằng vai trò user như mọi người (ADR 0023), nên chỉ thấy cơ sở khi được phân công
# approver; vai trò manager không tự cho thấy cơ sở trên danh mục.
gql "$admin_a" "$assign" "{\"f\":\"$facility\",\"u\":\"$(sub_of "$manager_a")\",\"d\":\"approver\"}" "$admin" >/dev/null

# Tệp thử nhỏ dạng PDF; nội dung không quan trọng, chỉ cần so được băm sau khi tải về.
pdf=$(printf '%%PDF-1.4\n%% Bien ban do dien tich %s\n%%%%EOF\n' "$code")
read -r status body < <(printf '%s' "$pdf" | upload "$user_a" bien-ban-do-dien-tich.pdf application/pdf)
file_id=$(jq -r .id <<<"$body")
check "user.a tải biên bản lên /v1/files" "$status $(jq -r .name <<<"$body")" "201 bien-ban-do-dien-tich.pdf"

link='mutation($f: uuid!, $file: uuid!) { insert_app_facilities_commune_facility_documents_one(
  object: {facility_id: $f, file_id: $file, note: "Biên bản đo diện tích"}) { tenant_id created_by } }'
out=$(gql "$user_a" "$link" "{\"f\":\"$facility\",\"file\":\"$file_id\"}")
check "user.a (phụ trách) gắn tệp vào cơ sở; tenant và người đính kèm lấy từ token" \
  "$(jq -r '.data.insert_app_facilities_commune_facility_documents_one | "\(.tenant_id) \(.created_by)"' <<<"$out")" \
  "xa-a $(sub_of "$user_a")"
out=$(gql "$user_a" 'mutation($f: uuid!, $file: uuid!) { insert_app_facilities_commune_facility_documents_one(
  object: {facility_id: $f, file_id: $file, created_by: "nguoi-khac"}) { id } }' \
  "{\"f\":\"$facility\",\"file\":\"$file_id\"}")
check "user.a không tự đặt được cột created_by" "$(errors "$out")" true

listed='query($f: uuid!) { rows: app_facilities_commune_facility_documents(where: {facility_id: {_eq: $f}}) {
  file_id } }'
rows() { gql "$1" "$listed" "{\"f\":\"$facility\"}" | jq -c '[.data.rows[].file_id]'; }
digest() { curl -fsS -H "Authorization: Bearer $1" "$files/$file_id/content" | sha256sum | cut -d' ' -f1; }
want=$(printf '%s' "$pdf" | sha256sum | cut -d' ' -f1)
check "user.a thấy tệp của cơ sở" "$(rows "$user_a")" "[\"$file_id\"]"
check "Người duyệt xã A (approver, vai trò user) thấy tệp của cơ sở" "$(rows "$manager_a")" "[\"$file_id\"]"
check "Người duyệt xã A tải về đúng nội dung đã tải lên" "$(digest "$manager_a")" "$want"
check "Người duyệt (approver) không gắn được tệp vào cơ sở" \
  "$(errors "$(gql "$manager_a" "$link" "{\"f\":\"$facility\",\"file\":\"$file_id\"}")")" true

check "user.b (xã B) không thấy dòng nối của cơ sở xã A" "$(rows "$user_b")" "[]"
check "user.b nhận 404 với mã tệp của xã A" \
  "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $user_b" "$files/$file_id") \
$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $user_b" "$files/$file_id/content")" "404 404"
check "user.b không gắn được tệp vào cơ sở xã A" \
  "$(errors "$(gql "$user_b" "$link" "{\"f\":\"$facility\",\"file\":\"$file_id\"}")")" true

# Chuỗi EICAR ghép từ hai nửa lúc chạy như scripts/smoke.sh, để tệp này không bị phần mềm diệt virus nhận là nhiễm.
# shellcheck disable=SC2016 # "$" là ký tự của chuỗi thử, không phải biến.
eicar='X5O!P%@AP[4\PZX54(P^)7CC)7}$'
# shellcheck disable=SC2016
eicar+='EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
read -r status body < <(printf '%s' "$eicar" | upload "$user_a" nhiem.pdf application/pdf)
check "Tệp thử EICAR bị từ chối, không có mã tệp để gắn" "$status $(jq -r '.id // "không có"' <<<"$body")" \
  "422 không có"
check "Sau lần từ chối, cơ sở vẫn chỉ có một tệp" "$(rows "$user_a")" "[\"$file_id\"]"

change='mutation($f: uuid!) { update_app_facilities_commune_facility_documents(where: {facility_id: {_eq: $f}},
  _set: {note: "bị sửa"}) { affected_rows } delete_app_facilities_commune_facility_documents(
  where: {facility_id: {_eq: $f}}) { affected_rows } }'
check "Dòng nối không sửa, không xóa được, kể cả quản trị xã" \
  "$(gql "$user_a" "$change" "{\"f\":\"$facility\"}" | jq -r '.errors[0].extensions.code') \
$(gql "$admin_a" "$change" "{\"f\":\"$facility\"}" "$admin" | jq -r '.errors[0].extensions.code')" \
  "validation-failed validation-failed"
audit=$(docker compose exec -T postgres psql -qXAt --username hasura --dbname mortise -v id="$facility" <<'SQL'
SELECT op || ' ' || actor FROM core.audit_log
WHERE table_name = 'app_facilities_commune.facility_documents' AND after ->> 'facility_id' = :'id' ORDER BY id LIMIT 1
SQL
)
check "Nhật ký ghi việc gắn tệp với đúng người làm" "$audit" "INSERT $(sub_of "$user_a")"

# Dọn: xóa cơ sở thử kéo theo phân công và dòng nối (ON DELETE CASCADE). Tệp vẫn ở core.files: API tệp không xóa.
gql "$admin_a" 'mutation($id: uuid!) { delete_app_facilities_commune_facilities_by_pk(id: $id) { id } }' \
  "{\"id\":\"$facility\"}" "$admin" >/dev/null
check "Xóa cơ sở thử thì dòng nối đi theo" "$(gql "$admin_a" "$listed" "{\"f\":\"$facility\"}" "$admin" |
  jq '.data.rows | length')" 0

exit $fail
