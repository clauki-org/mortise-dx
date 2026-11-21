#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm tra gói qua cổng APISIX sau khi `make app-install APP=facilities-commune`: mỗi tenant chỉ
# đọc và ghi cơ sở của mình, tenant do token quyết định chứ không do dữ liệu gửi lên, cán bộ chỉ
# thấy và sửa cơ sở mình được phân công (ADR 0015), khóa ngoại ghép chặn việc nối tòa hay phân công
# vào cơ sở của tenant khác, thay đổi qua Hasura để lại nhật ký ghi đúng người làm (ADR 0009), và
# menu của gói được nạp theo tenant. Dùng tài khoản demo của lõi; tự dọn dữ liệu đã tạo nên chạy lại
# nhiều lần không lỗi, trước hay sau `make seed-demo`. Cần lõi đang chạy và đã `make seed`.
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
tenant_a=xa-a
user_b=user.b
admin=tenant_admin
fail=0

check() {
  if [[ "$2" == "$3" ]]; then echo "PASS  $1"; else echo "FAIL  $1 (muốn: $3, nhận: $2)"; fail=1; fi
}

# Token lấy qua client mortise-test do `make seed` tạo; client giao diện không nhận mật khẩu trực tiếp. Người duyệt
# (manager) gửi kèm mã OTP: token USER [MÃ_OTP].
token() {
  curl -fsS "$base/auth/realms/mortise/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=mortise-test \
    -d "username=$1" -d "password=$DEMO_USER_PASSWORD" ${2:+-d "totp=$2"} | jq -r .access_token
}

# gql TOKEN QUERY [VARIABLES_JSON] [VAI_TRÒ]: in nguyên phản hồi GraphQL. Vai trò mặc định user; vai trò khác
# phải có trong token, Hasura chọn theo header X-Hasura-Role.
gql() {
  jq -cn --arg q "$2" --argjson v "${3:-{\}}" '{query: $q, variables: $v}' |
    curl -fsS -X POST "$base/v1/graphql" -H "Authorization: Bearer $1" -H "X-Hasura-Role: ${4:-user}" \
      -H 'Content-Type: application/json' -d @-
}

# sub của token: Hasura đặt vào x-hasura-user-id, nhật ký ghi lại làm người làm, phân công so với nó.
sub_of() {
  local payload
  payload=$(cut -d. -f2 <<<"$1" | tr '_-' '/+')
  while (( ${#payload} % 4 )); do payload+="="; done
  base64 -d <<<"$payload" | jq -r .sub
}

errors() { jq 'has("errors")' <<<"$1"; }
error_code() { jq -r '.errors[0].extensions.code // "không lỗi"'; }
created() { jq -r --arg f "$2" '.data[$f].id' <<<"$1"; }

token_a=$(token "$user_a")
token_b=$(token "$user_b")
admin_a=$(token admin.a)
admin_b=$(token admin.b)
# Mã riêng cho mỗi lần chạy: nếu lần trước dọn dở thì không vướng UNIQUE (tenant_id, code).
code="smoke-$(date +%s)-$RANDOM"

insert_facility='mutation($code: String!) {
  insert_app_facilities_commune_facilities_one(object: {code: $code, name: "Trụ sở kiểm thử"}) { id tenant_id }
}'
out=$(gql "$admin_a" "$insert_facility" "{\"code\":\"$code\"}" "$admin")
fac_a=$(created "$out" insert_app_facilities_commune_facilities_one)
check "admin.a tạo cơ sở, tenant lấy từ token" \
  "$(jq -r '.data.insert_app_facilities_commune_facilities_one.tenant_id' <<<"$out")" "$tenant_a"

# Đường ghi đầu tiên của người dùng qua Hasura: nhật ký phải ghi sub của token và vai trò, không phải tài khoản CSDL.
# psql chỉ thay biến :'id' trong SQL đọc từ stdin, không thay trong chuỗi của -c.
audit=$(docker compose exec -T postgres psql -qXAt --username hasura --dbname mortise -v id="$fac_a" <<'SQL'
SELECT tenant_id || ' ' || op || ' ' || actor || ' ' || actor_role FROM core.audit_log
WHERE table_name = 'app_facilities_commune.facilities' AND row_key ->> 'id' = :'id' ORDER BY id DESC LIMIT 1
SQL
)
check "Nhật ký ghi thay đổi qua Hasura với đúng người làm" "$audit" "$tenant_a INSERT $(sub_of "$admin_a") $admin"

out=$(gql "$admin_a" 'mutation($code: String!) {
  insert_app_facilities_commune_facilities_one(object: {code: $code, name: "x", tenant_id: "xa-b"}) { id }
}' "{\"code\":\"$code-spoof\"}" "$admin")
check "admin.a không tự đặt được cột tenant_id" "$(errors "$out")" true
check "$user_a không tạo được cơ sở (chỉ quản trị xã tạo)" \
  "$(errors "$(gql "$token_a" "$insert_facility" "{\"code\":\"$code-user\"}")")" true
check "$user_a không tự nhận vai trò tenant_admin khi token không có" \
  "$(errors "$(gql "$token_a" "$insert_facility" "{\"code\":\"$code-role\"}" "$admin")")" true

out=$(gql "$admin_b" "$insert_facility" "{\"code\":\"$code\"}" "$admin")
fac_b=$(created "$out" insert_app_facilities_commune_facilities_one)
check "admin.b tạo cơ sở cùng mã (mã chỉ duy nhất trong một tenant)" \
  "$([[ -n "$fac_b" && "$fac_b" != null ]] && echo yes)" yes

# Cơ sở do lần chạy này tạo (mã bắt đầu bằng $code), theo thứ tự tạo.
list='query($code: String!) {
  app_facilities_commune_facilities(where: {code: {_like: $code}}, order_by: {code: asc}) { id } }'
ids() { gql "$1" "$list" "{\"code\":\"$code%\"}" "${2:-user}" | jq -c '[.data.app_facilities_commune_facilities[].id]'; }
check "admin.a chỉ thấy cơ sở của xã mình" "$(ids "$admin_a" "$admin")" "[\"$fac_a\"]"
check "admin.b không thấy cơ sở của xã A" "$(ids "$admin_b" "$admin")" "[\"$fac_b\"]"

insert_building='mutation($f: uuid!, $code: String!) {
  insert_app_facilities_commune_buildings_one(object: {facility_id: $f, code: $code, name: "Tòa kiểm thử"}) { id }
}'
insert_room='mutation($b: uuid!, $code: String!, $type: String!, $area: numeric!) {
  insert_app_facilities_commune_rooms_one(object: {building_id: $b, code: $code, name: "Phòng kiểm thử",
    area_type: $type, clear_area_m2: $area}) { id tenant_id }
}'
out=$(gql "$admin_a" "$insert_building" "{\"f\":\"$fac_a\",\"code\":\"$code\"}" "$admin")
bld_a=$(created "$out" insert_app_facilities_commune_buildings_one)
gql "$admin_a" "$insert_room" "{\"b\":\"$bld_a\",\"code\":\"$code\",\"type\":\"working\",\"area\":20}" "$admin" >/dev/null

# Chưa phân công: cán bộ cùng xã không thấy cơ sở, tòa, phòng (quyền đi qua một, hai, ba bảng) và không ghi được.
children='query($code: String!) { app_facilities_commune_buildings(where: {code: {_eq: $code}}) { id }
  app_facilities_commune_rooms(where: {code: {_eq: $code}}) { id } }'
seen() { gql "$token_a" "$children" "{\"code\":\"$code\"}" |
  jq -c '[(.data.app_facilities_commune_buildings | length), (.data.app_facilities_commune_rooms | length)]'; }
check "$user_a chưa được phân công: không thấy cơ sở" "$(ids "$token_a")" "[]"
check "$user_a chưa được phân công: không thấy tòa, phòng của cơ sở" "$(seen)" "[0,0]"
check "$user_a chưa được phân công: không thêm được tòa" \
  "$(errors "$(gql "$token_a" "$insert_building" "{\"f\":\"$fac_a\",\"code\":\"$code-u\"}")")" true

assign='mutation($f: uuid!, $u: String!, $d: String!) {
  insert_app_facilities_commune_facility_assignments_one(object: {facility_id: $f, user_id: $u, duty: $d}) {
    id tenant_id } }'
sub_a=$(sub_of "$token_a")
check "Khóa ngoại ghép: admin.a không phân công vào cơ sở của xã B" \
  "$(errors "$(gql "$admin_a" "$assign" "{\"f\":\"$fac_b\",\"u\":\"$sub_a\",\"d\":\"custodian\"}" "$admin")")" true
out=$(gql "$admin_a" 'mutation($f: uuid!, $u: String!) {
  insert_app_facilities_commune_facility_assignments_one(object: {facility_id: $f, user_id: $u, duty: "custodian",
    tenant_id: "xa-b"}) { id } }' "{\"f\":\"$fac_b\",\"u\":\"$sub_a\"}" "$admin")
check "admin.a không ghi được phân công cho xã B bằng cột tenant_id" "$(errors "$out")" true
check "$user_a không tự phân công cho mình" \
  "$(errors "$(gql "$token_a" "$assign" "{\"f\":\"$fac_a\",\"u\":\"$sub_a\",\"d\":\"custodian\"}")")" true
out=$(gql "$admin_a" "$assign" "{\"f\":\"$fac_a\",\"u\":\"$sub_a\",\"d\":\"custodian\"}" "$admin")
check "admin.a phân công $user_a phụ trách cơ sở, tenant lấy từ token" \
  "$(jq -r '.data.insert_app_facilities_commune_facility_assignments_one.tenant_id' <<<"$out")" "$tenant_a"

# Cơ sở thứ hai của xã A, chưa phân công cho ai: cán bộ thấy cơ sở được phân công mà không thấy cơ sở này.
out=$(gql "$admin_a" "$insert_facility" "{\"code\":\"$code-2\"}" "$admin")
fac_a2=$(created "$out" insert_app_facilities_commune_facilities_one)
check "$user_a được phân công: thấy đúng cơ sở đó, không thấy cơ sở khác của xã" "$(ids "$token_a")" "[\"$fac_a\"]"
check "$user_a được phân công: thấy tòa, phòng của cơ sở" "$(seen)" "[1,1]"
check "$user_b (xã khác) không thấy cơ sở của xã A" "$(ids "$token_b")" "[]"
out=$(gql "$token_b" 'mutation($id: uuid!) {
  update_app_facilities_commune_facilities_by_pk(pk_columns: {id: $id}, _set: {name: "bị sửa"}) { id }
}' "{\"id\":\"$fac_a\"}")
check "$user_b không sửa được cơ sở của xã A" "$(jq -r '.data.update_app_facilities_commune_facilities_by_pk' <<<"$out")" null

out=$(gql "$token_a" "$insert_building" "{\"f\":\"$fac_b\",\"code\":\"$code\"}")
check "Khóa ngoại ghép: $user_a không nối tòa vào cơ sở của tenant khác" "$(errors "$out")" true
out=$(gql "$token_a" "$insert_building" "{\"f\":\"$fac_a\",\"code\":\"$code-u\"}")
bld_u=$(created "$out" insert_app_facilities_commune_buildings_one)
check "$user_a phụ trách cơ sở: nối được tòa vào cơ sở" "$([[ -n "$bld_u" && "$bld_u" != null ]] && echo yes)" yes

# Tọa độ của cơ sở (ADR 0020): CSDL chặn giá trị ngoài miền và cặp thiếu một vế; custodian sửa được; mỗi cơ sở đọc
# được phần vượt của xã mình qua quan hệ summary; tỉnh thấy cơ sở đang dùng của xã con qua view facility_rollup, kể cả
# cơ sở chưa có tọa độ (để biết còn thiếu), còn xã không đọc được view đó.
locate='mutation($id: uuid!, $set: app_facilities_commune_facilities_set_input!) {
  update_app_facilities_commune_facilities_by_pk(pk_columns: {id: $id}, _set: $set) { id } }'
locate_a() { gql "$1" "$locate" "{\"id\":\"$fac_a\",\"set\":$2}" "${3:-user}"; }
check "Vĩ độ ngoài khoảng -90..90 bị từ chối" \
  "$(errors "$(locate_a "$admin_a" '{"latitude":91,"longitude":0}' "$admin")")" true
check "Có vĩ độ mà thiếu kinh độ bị từ chối" "$(errors "$(locate_a "$admin_a" '{"latitude":0.5}' "$admin")")" true
check "$user_a phụ trách cơ sở: ghi được tọa độ" "$(locate_a "$token_a" '{"latitude":0.5,"longitude":0.25}' |
  jq -r '.data.update_app_facilities_commune_facilities_by_pk.id')" "$fac_a"
check "$user_a đọc tọa độ và dòng tổng hợp của xã mình qua quan hệ summary" \
  "$(gql "$token_a" 'query($id: uuid!) { app_facilities_commune_facilities_by_pk(id: $id) {
    latitude longitude summary { tenant_id } } }' "{\"id\":\"$fac_a\"}" |
    jq -c '.data.app_facilities_commune_facilities_by_pk | [.latitude + 0, .longitude + 0, .summary.tenant_id]')" \
  "[0.5,0.25,\"$tenant_a\"]"
leader=$(token leader.tinh)
facility_rollup='query($code: String!) { app_facilities_commune_facility_rollup(where: {code: {_eq: $code}},
  order_by: {tenant_id: asc}) { parent_tenant_id tenant_id latitude } }'
check "Tỉnh thấy cơ sở đang dùng của hai xã trong facility_rollup, cơ sở chưa có tọa độ để trống" \
  "$(gql "$leader" "$facility_rollup" "{\"code\":\"$code\"}" rollup_reader |
    jq -c '[.data.app_facilities_commune_facility_rollup[] |
      [.parent_tenant_id, .tenant_id, (if .latitude == null then null else .latitude + 0 end)]]')" \
  '[["tinh-mau","xa-a",0.5],["tinh-mau","xa-b",null]]'
check "Tỉnh (rollup_reader) không đọc được bảng cơ sở" \
  "$(gql "$leader" "$list" "{\"code\":\"$code\"}" rollup_reader | error_code)" validation-failed
check "Xã không đọc được facility_rollup, view chỉ dành cho tenant cha" \
  "$(gql "$token_a" "$facility_rollup" "{\"code\":\"$code\"}" | error_code)" validation-failed

# Phòng: loại diện tích và diện tích thông thủy là căn cứ tính định mức, CSDL chặn giá trị sai.
room() { gql "$token_a" "$insert_room" "{\"b\":\"$bld_u\",\"code\":\"$1\",\"type\":\"$2\",\"area\":$3}"; }
out=$(room "$code-1" working 18.5)
check "$user_a thêm phòng làm việc, tenant lấy từ token" \
  "$(jq -r '.data.insert_app_facilities_commune_rooms_one.tenant_id' <<<"$out")" "$tenant_a"
check "Phòng có loại diện tích ngoài working/shared/specialized bị từ chối" \
  "$(room "$code-2" office 10 | jq 'has("errors")')" true
check "Phòng có diện tích thông thủy bằng 0 bị từ chối" "$(room "$code-3" shared 0 | jq 'has("errors")')" true

# Ở cơ sở thứ hai, cán bộ chỉ là người duyệt (approver): thấy nhưng không sửa được; và không chuyển được tòa mình
# phụ trách sang cơ sở đó.
gql "$admin_a" "$assign" "{\"f\":\"$fac_a2\",\"u\":\"$sub_a\",\"d\":\"approver\"}" "$admin" >/dev/null
check "$user_a là người duyệt cơ sở thứ hai: thấy cả hai cơ sở" "$(ids "$token_a" | jq -c 'length')" 2
out=$(gql "$token_a" 'mutation($id: uuid!) {
  update_app_facilities_commune_facilities_by_pk(pk_columns: {id: $id}, _set: {name: "bị sửa"}) { id }
}' "{\"id\":\"$fac_a2\"}")
check "$user_a là người duyệt: không sửa được cơ sở" \
  "$(jq -r '.data.update_app_facilities_commune_facilities_by_pk' <<<"$out")" null
check "$user_a là người duyệt: không thêm được tòa" \
  "$(errors "$(gql "$token_a" "$insert_building" "{\"f\":\"$fac_a2\",\"code\":\"$code-x\"}")")" true
out=$(gql "$token_a" 'mutation($id: uuid!, $f: uuid!) {
  update_app_facilities_commune_buildings_by_pk(pk_columns: {id: $id}, _set: {facility_id: $f}) { id }
}' "{\"id\":\"$bld_u\",\"f\":\"$fac_a2\"}")
# So đúng lỗi quyền: lỗi khác (sai truy vấn, trùng mã) cũng làm mutation hỏng nhưng không chứng minh quyền chặn.
check "$user_a không chuyển được tòa sang cơ sở mình không phụ trách" \
  "$(jq -r '.errors[0].message // "không lỗi"' <<<"$out")" "check constraint of an insert/update permission has failed"

# Một phân công của người khác cùng xã, để thấy cán bộ chỉ đọc được dòng của chính mình. sub giả không cấp quyền gì:
# quyền vẫn so với sub trong token của người gọi.
gql "$admin_a" "$assign" "{\"f\":\"$fac_a\",\"u\":\"other-$code\",\"d\":\"custodian\"}" "$admin" >/dev/null
mine='{ app_facilities_commune_facility_assignments { user_id } }'
others() { gql "$1" "$mine" "{}" "${2:-user}" | jq --arg s "other-$code" \
  '[.data.app_facilities_commune_facility_assignments[] | select(.user_id == $s)] | length'; }
check "admin.a thấy phân công của người khác trong xã" "$(others "$admin_a" "$admin")" 1
check "$user_a chỉ đọc được phân công của chính mình" \
  "$(gql "$token_a" "$mine" | jq -c '[.data.app_facilities_commune_facility_assignments[].user_id] | unique')" \
  "[\"$sub_a\"]"
check "admin.b không thấy phân công của xã A" \
  "$(gql "$admin_b" "$mine" "{}" "$admin" | jq --arg s "$sub_a" \
    '[.data.app_facilities_commune_facility_assignments[] | select(.user_id == $s)] | length')" 0

# Lãnh đạo xã (manager) đọc toàn xã dù không được phân công; người duyệt phải gửi kèm mã OTP (ADR 0011).
manager_a=$(token manager.a "$(uv run --quiet --no-project python scripts/otp.py next manager.a)")
check "manager.a đọc được cơ sở chưa phân công cho mình trong xã" "$(ids "$manager_a" manager | jq -c 'length')" 2
check "manager.a không thêm được cơ sở" \
  "$(errors "$(gql "$manager_a" "$insert_facility" "{\"code\":\"$code-m\"}" manager)")" true

delete_facility='mutation($id: uuid!) { delete_app_facilities_commune_facilities_by_pk(id: $id) { id } }'
check "$user_a không xóa được cơ sở" "$(errors "$(gql "$token_a" "$delete_facility" "{\"id\":\"$fac_a\"}")")" true
out=$(gql "$admin_b" "$delete_facility" "{\"id\":\"$fac_a\"}" "$admin")
check "admin.b không xóa được cơ sở của xã A" "$(jq -r '.data.delete_app_facilities_commune_facilities_by_pk' <<<"$out")" null
out=$(gql "$admin_a" "$delete_facility" "{\"id\":\"$fac_a\"}" "$admin")
check "ON DELETE RESTRICT: không xóa được cơ sở còn tòa" "$(errors "$out")" true

# Dọn: con trước, cha sau; phân công đi theo cơ sở (ON DELETE CASCADE).
gql "$admin_a" 'mutation($code: String!) {
  delete_app_facilities_commune_rooms(where: {code: {_like: $code}}) { affected_rows }
  delete_app_facilities_commune_buildings(where: {code: {_like: $code}}) { affected_rows }
  delete_app_facilities_commune_facilities(where: {code: {_like: $code}}) { affected_rows } }' \
  "{\"code\":\"$code%\"}" "$admin" >/dev/null
gql "$admin_b" "$delete_facility" "{\"id\":\"$fac_b\"}" "$admin" >/dev/null
check "Dọn dữ liệu kiểm thử" "$(ids "$admin_a" "$admin")" "[]"
left='query($f: [uuid!]!) { app_facilities_commune_facility_assignments(where: {facility_id: {_in: $f}}) { id } }'
check "Xóa cơ sở thì phân công của nó đi theo" "$(gql "$admin_a" "$left" "{\"f\":[\"$fac_a\",\"$fac_a2\"]}" "$admin" |
  jq '.data.app_facilities_commune_facility_assignments | length')" 0


# Menu của gói (app.yaml, nạp khi cài): mỗi tenant thấy mục của mình kèm nội dung cấu hình danh mục, không thấy dòng
# của tenant khác.
menu='{ platform_menu_items(where: {app: {_eq: "facilities-commune"}}) { tenant_id item component config } }'
check "Menu của gói: user.a thấy mục danh mục cơ sở kèm cấu hình, chỉ của xã mình" \
  "$(gql "$token_a" "$menu" | jq -c '[.data.platform_menu_items[] | [.tenant_id, .item, .component, .config.source]]')" \
  '[["xa-a","facilities","catalog","app_facilities_commune_facilities"]]'
check "Menu của gói: user.b chỉ thấy mục của xã mình" \
  "$(gql "$token_b" "$menu" | jq -c '[.data.platform_menu_items[].tenant_id] | unique')" '["xa-b"]'

# Tổng hợp cho tenant cha (ADR 0016): leader.tinh (tenant tinh-mau, vai trò rollup_reader) thấy đúng ba xã con trong
# view area_rollup, không đọc được bảng gốc dưới vai trò nào; xã không đọc được view tổng hợp.
rollup='{ app_facilities_commune_area_rollup(order_by: {tenant_id: asc}) { parent_tenant_id tenant_id tenant_name
  allowed_m2 in_use_m2 surplus_m2 excess_m2 } }'
check "Tỉnh thấy đúng ba xã con trong tổng hợp" \
  "$(gql "$leader" "$rollup" "{}" rollup_reader | jq -c '[.data.app_facilities_commune_area_rollup[] |
    [.parent_tenant_id, .tenant_id]]')" '[["tinh-mau","xa-a"],["tinh-mau","xa-b"],["tinh-mau","xa-c"]]'
rooms='{ app_facilities_commune_rooms { id } }'
check "Tỉnh (rollup_reader) không đọc được bảng phòng" "$(gql "$leader" "$rooms" "{}" rollup_reader | error_code)" \
  validation-failed
check "Tỉnh (user) không thấy phòng nào của xã" "$(gql "$leader" "$rooms" "{}" user |
  jq -c '.data.app_facilities_commune_rooms')" '[]'
check "Xã không đọc được tổng hợp của tỉnh" "$(gql "$token_a" "$rollup" "{}" user | error_code)" validation-failed
check "Xã không tự nhận vai trò rollup_reader khi token không có" \
  "$(gql "$token_a" "$rollup" "{}" rollup_reader | error_code)" access-denied

# Dữ liệu demo (`make seed-demo`, seed/demo.yaml): tổng diện tích thông thủy theo trạng thái cơ sở của từng xã đúng số
# liệu của câu chuyện demo. Đọc bằng quản trị xã để thấy toàn xã, không phụ thuộc phân công. Chưa nạp thì bỏ qua, để
# smoke của gói vẫn chạy được trên bản cài không có dữ liệu demo.
areas='{ app_facilities_commune_facilities { id status code }
  app_facilities_commune_buildings { id facility_id } app_facilities_commune_rooms { building_id clear_area_m2 } }'
totals() { # TOKEN: in "<trạng thái>=<tổng m²>" theo thứ tự trạng thái
  gql "$1" "$areas" "{}" "$admin" | jq -r '.data as $d
    | ($d.app_facilities_commune_facilities | map({(.id): .status}) | add) as $status
    | ($d.app_facilities_commune_buildings | map({(.id): $status[.facility_id]}) | add) as $of
    | $d.app_facilities_commune_rooms | group_by($of[.building_id])
    | map("\($of[.[0].building_id])=\(map(.clear_area_m2 | tonumber) | add)") | join(" ")'
}
# Kết quả tính của từng xã (view area_summary): được phép = làm việc theo biên chế + sử dụng chung bằng phần làm việc
# + chuyên dùng; thực tế chỉ cộng cơ sở đang dùng; phần vượt không âm. View là số tổng của cả xã nên cán bộ đọc được
# dù chỉ được phân công một phần cơ sở.
summary_query='{ app_facilities_commune_area_summary { tenant_id allowed_m2 in_use_m2 surplus_m2 excess_m2 } }'
summary() { # TOKEN: in "<tenant> allowed=.. in_use=.. surplus=.. excess=.." cho mỗi dòng thấy được
  gql "$1" "$summary_query" | jq -r '.data.app_facilities_commune_area_summary[]
    | "\(.tenant_id) allowed=\(.allowed_m2 | tonumber + 0) in_use=\(.in_use_m2 | tonumber + 0)"
      + " surplus=\(.surplus_m2 | tonumber + 0) excess=\(.excess_m2 | tonumber + 0)"'
}
admin_c=$(token admin.c)
# Xã nào đã có một cơ sở demo thì coi như đã nạp và kiểm cả ba xã, để nạp sót một xã không làm smoke bỏ qua.
demo_codes='{ app_facilities_commune_facilities(where: {code: {_like: "TS-%"}}) { id } }'
loaded=0
for access in "$admin_a" "$admin_b" "$admin_c"; do
  loaded=$((loaded + $(gql "$access" "$demo_codes" "{}" "$admin" | jq '.data.app_facilities_commune_facilities | length')))
done
if ((loaded > 0)); then
  # Dọn diện tích chuyên dùng mà lần chạy trước để sót (dừng giữa lúc thêm và xóa), nếu không phần vượt của xã A lệch
  # ở mọi lần sau.
  gql "$token_a" 'mutation { delete_app_facilities_commune_specialized_allowances(
    where: {basis: {_eq: "Kiểm thử smoke"}}) { affected_rows } }' >/dev/null
  check "Xã A: được phép 580 m², dùng 1.000 m², vượt 420 m²; chỉ thấy dòng của mình" "$(summary "$token_a")" \
    "xa-a allowed=580 in_use=1000 surplus=0 excess=420"
  check "Xã B: được phép 600 m², dùng 730 m², vượt 130 m²" "$(summary "$token_b")" \
    "xa-b allowed=600 in_use=730 surplus=0 excess=130"
  check "Xã C: được phép 480 m², dùng 460 m², không vượt; dôi dư 250 m² tính riêng" "$(summary "$(token user.c)")" \
    "xa-c allowed=480 in_use=460 surplus=250 excess=0"
  check "Mức m² của biên chế trỏ về đúng dòng phụ lục" \
    "$(gql "$token_a" '{ app_facilities_commune_staffing_allowances(where: {norm_row: {_eq: 10}}) {
      headcount max_m2 allowed_m2 source } }' |
      jq -c '.data.app_facilities_commune_staffing_allowances[] | [.headcount, (.max_m2 | tonumber + 0),
        (.allowed_m2 | tonumber + 0), .source]')" \
    '[14,15,210,"Phụ lục NĐ 369/2026/NĐ-CP, STT 10"]'
  # Diện tích chuyên dùng do cấp có thẩm quyền quyết định cộng thẳng vào phần được phép.
  extra=$(gql "$token_a" 'mutation($name: String!) { insert_app_facilities_commune_specialized_allowances_one(
    object: {name: $name, area_m2: 50, basis: "Kiểm thử smoke"}) { id } }' "{\"name\":\"$code\"}" |
    jq -r '.data.insert_app_facilities_commune_specialized_allowances_one.id')
  check "Thêm 50 m² chuyên dùng: phần vượt của xã A còn 370 m²" "$(summary "$token_a" | grep -o 'excess=[0-9]*')" \
    "excess=370"
  gql "$token_a" 'mutation($id: uuid!) { delete_app_facilities_commune_specialized_allowances_by_pk(id: $id) { id } }' \
    "{\"id\":\"$extra\"}" >/dev/null
  check "Dữ liệu demo xã A: 1.000 m² thông thủy đang dùng" "$(totals "$admin_a")" "in_use=1000"
  check "Dữ liệu demo xã B: 730 m² thông thủy đang dùng" "$(totals "$admin_b")" "in_use=730"
  check "Dữ liệu demo xã C: 460 m² đang dùng, 250 m² dôi dư" "$(totals "$admin_c")" "in_use=460 surplus=250"
  check "Dữ liệu demo: $user_a phụ trách mọi cơ sở demo của xã A" "$(gql "$token_a" "$demo_codes" |
    jq '.data.app_facilities_commune_facilities | length')" 2
  # Tỉnh thấy đúng số của xã, lấy từ cùng area_summary nên không lệch với số xã tự thấy.
  check "Tỉnh thấy số liệu ba xã khớp số của từng xã" \
    "$(gql "$leader" "$rollup" "{}" rollup_reader | jq -r '.data.app_facilities_commune_area_rollup[] |
      "\(.tenant_id) allowed=\(.allowed_m2 | tonumber + 0) in_use=\(.in_use_m2 | tonumber + 0)"
      + " surplus=\(.surplus_m2 | tonumber + 0) excess=\(.excess_m2 | tonumber + 0)"' | paste -sd ';')" \
    "$(for access in "$token_a" "$token_b" "$(token user.c)"; do summary "$access"; done | paste -sd ';')"
  # Bản đồ cần mọi cơ sở demo có tọa độ, kể cả cơ sở dôi dư; tỉnh thấy đúng các trụ sở đang dùng kèm phần vượt của xã,
  # không thấy cơ sở dôi dư; cán bộ thấy phần vượt của xã trên từng cơ sở mình phụ trách.
  unplaced='{ app_facilities_commune_facilities(where: {code: {_like: "TS-%"}, latitude: {_is_null: true}}) { code } }'
  check "Dữ liệu demo: mọi cơ sở của ba xã có tọa độ" "$(for access in "$admin_a" "$admin_b" "$admin_c"; do
    gql "$access" "$unplaced" "{}" "$admin" | jq -c '.data.app_facilities_commune_facilities'; done | paste -sd ' ')" \
    "[] [] []"
  check "Tỉnh thấy trụ sở đang dùng của ba xã có tọa độ, kèm phần vượt của xã, không thấy cơ sở dôi dư" \
    "$(gql "$leader" '{ app_facilities_commune_facility_rollup(where: {code: {_like: "TS-%"}},
      order_by: [{tenant_id: asc}, {code: asc}]) { tenant_id code latitude excess_m2 } }' "{}" rollup_reader |
      jq -c '[.data.app_facilities_commune_facility_rollup[] | [.tenant_id, .code, .latitude != null,
        (.excess_m2 | tonumber + 0)]]')" \
    '[["xa-a","TS-A1",true,420],["xa-a","TS-A2",true,420],["xa-b","TS-B1",true,130],["xa-c","TS-C1",true,0]]'
  check "$user_a thấy phần vượt của xã A trên từng cơ sở demo mình phụ trách" \
    "$(gql "$token_a" '{ app_facilities_commune_facilities(where: {code: {_like: "TS-%"}}, order_by: {code: asc}) {
      code summary { excess_m2 } } }' | jq -c '[.data.app_facilities_commune_facilities[] |
        [.code, (.summary.excess_m2 | tonumber + 0)]]')" '[["TS-A1",420],["TS-A2",420]]'
else
  echo "SKIP  Dữ liệu demo chưa nạp (make seed-demo)"
fi

# Kiểm tra kho lưu trữ (rules/archive-humidity.yaml, ADR 0018): độ ẩm kho xã A vượt 75% liên tục 5 phút thì
# manager.a có việc "Kiểm tra kho lưu trữ". Số đo gửi qua MQTT như thiết bị thật; observedAt do thiết bị gửi nên lùi
# thời điểm được, không phải chờ 5 phút. Dùng một thiết bị riêng cấp lúc chạy, vì số đo của thiết bị demo (bộ giả
# lập) chen vào giữa sẽ cắt chuỗi vượt ngưỡng; thu hồi tài khoản khi xong.
sensor=archive-smoke
sensor_password=$(openssl rand -hex 16)
scripts/device.sh add "$tenant_a" "$sensor" "$sensor_password" >/dev/null
tasks() {
  curl -fsS -H "Authorization: Bearer $1" "$base/v1/workflow/tasks" |
    jq -r --arg d "$sensor" '.[] | select(.process == "archive-inspection" and .variables.device == $d) | .id'
}
inspect_done() {
  local task
  for task in $(tasks "$manager_a"); do
    curl -fsS -o /dev/null -X POST -H "Authorization: Bearer $manager_a" -H 'Content-Type: application/json' \
      -d '{"variables":{"finding":"Kiểm thử tự động","inspected":true}}' "$base/v1/workflow/tasks/$task/complete"
  done
}
humidity() { # GIÁ_TRỊ GIÂY_LÙI
  docker compose exec -T mosquitto mosquitto_pub -u "$tenant_a.$sensor" -P "$sensor_password" -q 1 \
    -t "mortise/$tenant_a/$sensor" \
    -m "{\"observedAt\": \"$(date -u -d "-$2 seconds" +%FT%TZ)\", \"measurements\": {\"humidity\": $1}}" \
    >/dev/null 2>&1 || true
}
# Thiết bị này chỉ smoke dùng và chỉ nhận số đo vượt ngưỡng: số đo bình thường của lần chạy trước nằm trong 5 phút
# của lần chạy sau sẽ cắt chuỗi, nên không gửi số đo bình thường nào.
inspect_done
humidity 80 310
sleep 1
# Cầu nối đọc lại luật mỗi 30 giây (core/iot-bridge/app/watch.py), nên ngay sau khi cài gói có thể chưa thấy
# luật: gửi lại số đo vượt mới nhất cho tới khi có việc, tối đa khoảng 45 giây.
opened=""
for _ in $(seq 1 22); do
  humidity 81 0
  opened=$(tasks "$manager_a" | head -1)
  [[ -n "$opened" ]] && break
  sleep 2
done
check "Độ ẩm kho xã A vượt ngưỡng 5 phút: manager.a có việc kiểm tra kho" "$([[ -n "$opened" ]] && echo yes)" yes
check "Chỉ một việc kiểm tra kho dù độ ẩm vẫn vượt" "$(tasks "$manager_a" | grep -c . || true)" 1
manager_b=$(token manager.b "$(uv run --quiet --no-project python scripts/otp.py next manager.b)")
check "manager.b (xã B) không thấy việc kiểm tra kho của xã A" "$(tasks "$manager_b" | grep -c . || true)" 0
# Dọn: ghi kết quả để bảng việc demo không tích việc do smoke để lại.
inspect_done
check "Ghi kết quả kiểm tra xong, không còn việc kiểm tra kho" "$(tasks "$manager_a" | grep -c . || true)" 0
scripts/device.sh remove "$tenant_a" "$sensor" >/dev/null

# Quy trình rà soát (ngưỡng, công khai có hẹn giờ, trình) ở tệp riêng; thời hạn công khai dài thì bỏ qua phần chờ.
apps/facilities-commune/tests/workflow.sh || fail=1

exit $fail
