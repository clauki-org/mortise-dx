#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Trường tùy chỉnh trên bảng cơ sở qua cổng (ADR 0059), gọi từ tests/smoke.sh: quản trị tỉnh (tenant gốc) định nghĩa
# trường, quản trị xã (tenant con) thì không; xã thấy trường của tỉnh, tỉnh khác không thấy; CSDL từ chối khóa lạ,
# lựa chọn ngoài danh sách và thiếu trường bắt buộc khi ghi qua Hasura; đổi định nghĩa có nhật ký. Trường mang mã riêng
# mỗi lần chạy và bị xóa khi thoát, kể cả khi bài dừng giữa chừng: trường bắt buộc còn sót sẽ chặn mọi lần thêm cơ sở
# ở các xã của tỉnh.
#
# SC2016: biến GraphQL ($c, $id) nằm trong nháy đơn để shell không mở rộng; giá trị đi qua trường variables.
# shellcheck disable=SC2016
set -euo pipefail
cd "$(dirname "$0")/../../.."
set -a
# shellcheck source=/dev/null
source .env
set +a

base="${MORTISE_PUBLIC_URL:-http://localhost:9080}"
admin=tenant_admin
target=app_facilities_commune_facilities
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
sql() { docker compose exec -T postgres psql -qAtX -v ON_ERROR_STOP=1 -U postgres -d mortise "$@"; }
errors() { jq 'has("errors")' <<<"$1"; }
# rejected PHẢN_HỒI MẪU: "yes" khi Hasura trả lỗi có thông báo khớp mẫu, để lỗi khác (sai truy vấn) không bị tính là
# CSDL đã từ chối đúng lý do.
rejected() { jq -r --arg p "$2" 'if (.errors[0].message // "" | test($p)) then "yes" else (.errors[0].message // "nhận") end' <<<"$1"; }

# Mã bắt đầu bằng smoke_: dọn cả trường do lần chạy trước bỏ dở; cơ sở thử mang mã cùng tiền tố với trường.
cleanup() {
  sql -c "DELETE FROM platform.custom_fields WHERE source = '$target' AND code LIKE 'smoke\_%'" >/dev/null
  sql -c "DELETE FROM app_facilities_commune.facilities WHERE code LIKE 'smoke-cf-%'" >/dev/null
}
cleanup
trap cleanup EXIT

admin_tinh=$(token admin.tinh)
admin_a=$(token admin.a)
user_a=$(token user.a)
manager_k=$(token manager.k "$(uv run --quiet --no-project python scripts/otp.py next manager.k)")
run="$(date +%s)_$RANDOM"
field="smoke_$run"
code="smoke-cf-$run"

define='mutation($c: String!, $t: String!) { insert_platform_custom_fields_one(object: {app: "facilities-commune",
  source: $t, code: $c, label: "Hãng (kiểm thử)", kind: "choice", choices: ["A", "B"]}) { root_tenant_id } }'
vars="{\"c\":\"$field\",\"t\":\"$target\"}"
check "Quản trị xã A (tenant con) không định nghĩa được trường" "$(errors "$(gql "$admin_a" "$define" "$vars" "$admin")")" true
check "Quản trị tỉnh định nghĩa trường, tenant gốc lấy từ token" \
  "$(gql "$admin_tinh" "$define" "$vars" "$admin" | jq -r '.data.insert_platform_custom_fields_one.root_tenant_id')" \
  tinh-mau

seen='query($c: String!) { platform_custom_fields(where: {code: {_eq: $c}}) { code } }'
count() { gql "$1" "$seen" "{\"c\":\"$field\"}" "${2:-user}" | jq '.data.platform_custom_fields | length'; }
check "Cán bộ xã A thấy trường tỉnh vừa thêm" "$(count "$user_a")" 1
check "Tỉnh khác không thấy trường của Tỉnh Mẫu" "$(count "$manager_k")" 0
relabel='mutation($c: String!) { update_platform_custom_fields(where: {code: {_eq: $c}}, _set: {label: "bị sửa"}) {
  affected_rows } }'
check "Quản trị xã A không sửa được trường của tỉnh" \
  "$(gql "$admin_a" "$relabel" "{\"c\":\"$field\"}" "$admin" | jq '.data.update_platform_custom_fields.affected_rows')" 0
check "Nhật ký ghi lần định nghĩa với tenant gốc và người làm" "$(sql -c "SELECT tenant_id || ' ' || actor
  FROM core.audit_log WHERE table_name = 'platform.custom_fields' AND op = 'INSERT' AND after ->> 'code' = '$field'")" \
  "tinh-mau $(sub_of "$admin_tinh")"

insert='mutation($code: String!, $custom: jsonb) { insert_app_facilities_commune_facilities_one(
  object: {code: $code, name: "Trụ sở kiểm thử trường tùy chỉnh", custom: $custom}) { custom } }'
facility() { gql "$admin_a" "$insert" "{\"code\":\"$code-$1\",\"custom\":$2}" "$admin"; }
check "Giá trị ngoài danh sách lựa chọn bị CSDL từ chối" "$(rejected "$(facility 1 "{\"$field\":\"C\"}")" 'một trong')" yes
check "Khóa chưa định nghĩa bị CSDL từ chối" \
  "$(rejected "$(facility 2 "{\"$field\":\"A\",\"${field}_x\":1}")" 'chưa được định nghĩa')" yes
check "Giá trị hợp lệ được ghi và đọc lại" \
  "$(facility 3 "{\"$field\":\"A\"}" | jq -c --arg f "$field" '.data.insert_app_facilities_commune_facilities_one.custom[$f]')" \
  '"A"'
required='mutation($c: String!) { update_platform_custom_fields(where: {code: {_eq: $c}}, _set: {required: true}) {
  affected_rows } }'
gql "$admin_tinh" "$required" "{\"c\":\"$field\"}" "$admin" >/dev/null
check "Trường bắt buộc: thêm cơ sở không điền bị từ chối" "$(rejected "$(facility 4 "{}")" 'bắt buộc')" yes

exit $fail
