#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm tra gói qua cổng APISIX sau khi `scripts/app.sh facilities-commune install`: mỗi tenant chỉ
# đọc và ghi cơ sở của mình, tenant do token quyết định chứ không do dữ liệu gửi lên, khóa ngoại
# ghép chặn việc nối tòa vào cơ sở của tenant khác, và thay đổi qua Hasura để lại nhật ký ghi đúng
# người làm (ADR 0009). Dùng hai tài khoản demo của lõi; tự dọn dữ liệu đã tạo nên chạy lại nhiều
# lần không lỗi. Cần lõi đang chạy và đã `make seed`.
#
# SC2016: biến GraphQL ($id, $code) phải nằm trong nháy đơn để shell không mở rộng; giá trị đi
# qua trường variables của yêu cầu, không ghép chuỗi, nên không có rủi ro tiêm vào truy vấn.
# shellcheck disable=SC2016
set -euo pipefail
cd "$(dirname "$0")/../../.."
# .env do `make env` sinh ra và không có trong repo, nên shellcheck không đọc theo.
set -a
# shellcheck source=/dev/null
source .env
set +a

base="${MORTISE_PUBLIC_URL:-http://localhost:9080}"
user_a=user.a
tenant_a=xuong-a
user_b=user.b
fail=0

check() {
  if [[ "$2" == "$3" ]]; then echo "PASS  $1"; else echo "FAIL  $1 (muốn: $3, nhận: $2)"; fail=1; fi
}

# Token lấy qua client mortise-test do `make seed` tạo; client giao diện không nhận mật khẩu trực tiếp.
token() {
  curl -fsS "$base/auth/realms/mortise/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=mortise-test \
    -d "username=$1" -d "password=$DEMO_USER_PASSWORD" | jq -r .access_token
}

# gql TOKEN QUERY [VARIABLES_JSON]: in nguyên phản hồi GraphQL.
gql() {
  jq -cn --arg q "$2" --argjson v "${3:-{\}}" '{query: $q, variables: $v}' |
    curl -fsS -X POST "$base/v1/graphql" -H "Authorization: Bearer $1" \
      -H 'Content-Type: application/json' -d @-
}

# sub của token: Hasura đặt vào x-hasura-user-id, nhật ký ghi lại làm người làm.
sub_of() {
  local payload
  payload=$(cut -d. -f2 <<<"$1" | tr '_-' '/+')
  while (( ${#payload} % 4 )); do payload+="="; done
  base64 -d <<<"$payload" | jq -r .sub
}

token_a=$(token "$user_a")
token_b=$(token "$user_b")
# Mã riêng cho mỗi lần chạy: nếu lần trước dọn dở thì không vướng UNIQUE (tenant_id, code).
code="smoke-$(date +%s)-$RANDOM"

insert_facility='mutation($code: String!) {
  insert_app_facilities_commune_facilities_one(object: {code: $code, name: "Trụ sở kiểm thử"}) { id tenant_id }
}'
out=$(gql "$token_a" "$insert_facility" "{\"code\":\"$code\"}")
fac_a=$(jq -r '.data.insert_app_facilities_commune_facilities_one.id' <<<"$out")
check "$user_a tạo cơ sở, tenant lấy từ token" \
  "$(jq -r '.data.insert_app_facilities_commune_facilities_one.tenant_id' <<<"$out")" "$tenant_a"

# Đường ghi đầu tiên của người dùng qua Hasura: nhật ký phải ghi sub của token và vai trò, không phải tài khoản CSDL.
# psql chỉ thay biến :'id' trong SQL đọc từ stdin, không thay trong chuỗi của -c.
audit=$(docker compose exec -T postgres psql -qXAt --username hasura --dbname mortise -v id="$fac_a" <<'SQL'
SELECT tenant_id || ' ' || op || ' ' || actor || ' ' || actor_role FROM core.audit_log
WHERE table_name = 'app_facilities_commune.facilities' AND row_key ->> 'id' = :'id' ORDER BY id DESC LIMIT 1
SQL
)
check "Nhật ký ghi thay đổi qua Hasura với đúng người làm" "$audit" "$tenant_a INSERT $(sub_of "$token_a") user"

out=$(gql "$token_a" 'mutation($code: String!) {
  insert_app_facilities_commune_facilities_one(object: {code: $code, name: "x", tenant_id: "xuong-b"}) { id }
}' "{\"code\":\"$code-spoof\"}")
check "$user_a không tự đặt được cột tenant_id" "$(jq 'has("errors")' <<<"$out")" true

out=$(gql "$token_b" "$insert_facility" "{\"code\":\"$code\"}")
fac_b=$(jq -r '.data.insert_app_facilities_commune_facilities_one.id' <<<"$out")
check "$user_b tạo cơ sở cùng mã (mã chỉ duy nhất trong một tenant)" \
  "$([[ -n "$fac_b" && "$fac_b" != null ]] && echo yes)" yes

list='query($code: String!) { app_facilities_commune_facilities(where: {code: {_eq: $code}}) { id } }'
ids() { gql "$1" "$list" "{\"code\":\"$code\"}" | jq -c '[.data.app_facilities_commune_facilities[].id]'; }
check "$user_a chỉ thấy cơ sở của mình" "$(ids "$token_a")" "[\"$fac_a\"]"
check "$user_b không thấy cơ sở của $user_a" "$(ids "$token_b")" "[\"$fac_b\"]"

out=$(gql "$token_b" 'mutation($id: uuid!) {
  update_app_facilities_commune_facilities_by_pk(pk_columns: {id: $id}, _set: {name: "bị sửa"}) { id }
}' "{\"id\":\"$fac_a\"}")
check "$user_b không sửa được cơ sở của $user_a" \
  "$(jq -r '.data.update_app_facilities_commune_facilities_by_pk' <<<"$out")" null

insert_building='mutation($f: uuid!, $code: String!) {
  insert_app_facilities_commune_buildings_one(object: {facility_id: $f, code: $code, name: "Tòa kiểm thử"}) { id }
}'
out=$(gql "$token_a" "$insert_building" "{\"f\":\"$fac_b\",\"code\":\"$code\"}")
check "Khóa ngoại ghép: $user_a không nối tòa vào cơ sở của tenant khác" "$(jq 'has("errors")' <<<"$out")" true

out=$(gql "$token_a" "$insert_building" "{\"f\":\"$fac_a\",\"code\":\"$code\"}")
bld_a=$(jq -r '.data.insert_app_facilities_commune_buildings_one.id' <<<"$out")
check "$user_a nối tòa vào cơ sở của mình" "$([[ -n "$bld_a" && "$bld_a" != null ]] && echo yes)" yes

delete_facility='mutation($id: uuid!) { delete_app_facilities_commune_facilities_by_pk(id: $id) { id } }'
out=$(gql "$token_a" "$delete_facility" "{\"id\":\"$fac_a\"}")
check "ON DELETE RESTRICT: không xóa được cơ sở còn tòa" "$(jq 'has("errors")' <<<"$out")" true

# Dọn: con trước, cha sau.
gql "$token_a" 'mutation($id: uuid!) { delete_app_facilities_commune_buildings_by_pk(id: $id) { id } }' \
  "{\"id\":\"$bld_a\"}" >/dev/null
gql "$token_a" "$delete_facility" "{\"id\":\"$fac_a\"}" >/dev/null
gql "$token_b" "$delete_facility" "{\"id\":\"$fac_b\"}" >/dev/null
check "Dọn dữ liệu kiểm thử" "$(ids "$token_a")" "[]"

exit $fail
