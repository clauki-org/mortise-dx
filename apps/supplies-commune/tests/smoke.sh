#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm tra gói qua cổng APISIX sau khi `make app-install APP=supplies-commune`: mỗi xã chỉ đọc và ghi kho của mình,
# tenant do token quyết định, cán bộ và lãnh đạo xã chỉ đọc, khóa ngoại ghép chặn việc đặt vật tư vào kho của xã khác,
# xóa kho còn vật tư bị từ chối, thay đổi có nhật ký (ADR 0009), menu nạp theo tenant, đề nghị cấp vật tư tới đúng
# người duyệt của xã và theo quy tắc bốn mắt. Có dữ liệu demo (`make seed-demo`) thì kiểm số kho, vật tư từng xã.
# Tệp này chỉ CI và người phát triển chạy, bộ cài gói không đọc tests/ (ADR 0022). Tự dọn dữ liệu đã tạo nên chạy
# lại nhiều lần không lỗi. Cần lõi đang chạy và đã `make seed`.
#
# SC2016: biến GraphQL ($code) phải nằm trong nháy đơn để shell không mở rộng; giá trị đi qua trường variables của
# yêu cầu, không ghép chuỗi.
# shellcheck disable=SC2016
set -euo pipefail
cd "$(dirname "$0")/../../.."
# .env do `make env` sinh ra và không có trong repo, nên shellcheck không đọc theo.
set -a
# shellcheck source=/dev/null
source .env
set +a

base="${MORTISE_PUBLIC_URL:-http://localhost:9080}"
admin=tenant_admin
process=supply-request
fail=0

check() {
  if [[ "$2" == "$3" ]]; then echo "PASS  $1"; else echo "FAIL  $1 (muốn: $3, nhận: $2)"; fail=1; fi
}

# Token qua client mortise-test do `make seed` tạo; người duyệt (manager) gửi kèm mã OTP: token USER [MÃ_OTP].
token() {
  curl -fsS "$base/auth/realms/mortise/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=mortise-test \
    -d "username=$1" -d "password=$DEMO_USER_PASSWORD" ${2:+-d "totp=$2"} | jq -r .access_token
}

# gql TOKEN QUERY [VARIABLES_JSON] [VAI_TRÒ]: in nguyên phản hồi GraphQL; vai trò mặc định user.
gql() {
  jq -cn --arg q "$2" --argjson v "${3:-{\}}" '{query: $q, variables: $v}' |
    curl -fsS -X POST "$base/v1/graphql" -H "Authorization: Bearer $1" -H "X-Hasura-Role: ${4:-user}" \
      -H 'Content-Type: application/json' -d @-
}

# api TOKEN METHOD ĐƯỜNG [THÂN_JSON]: gọi API quy trình, in thân phản hồi rồi mã HTTP ở dòng cuối.
api() {
  curl -sS -X "$2" "$base/v1/workflow$3" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' \
    ${4:+-d "$4"} -w '\n%{http_code}'
}

sub_of() {
  local payload
  payload=$(cut -d. -f2 <<<"$1" | tr '_-' '/+')
  while ((${#payload} % 4)); do payload+="="; done
  base64 -d <<<"$payload" | jq -r .sub
}

errors() { jq 'has("errors")' <<<"$1"; }

user_a=$(token user.a)
user_b=$(token user.b)
admin_a=$(token admin.a)
admin_b=$(token admin.b)
# Người duyệt phải đăng nhập hai bước (ADR 0011); một token cho cả bài để không tốn mã OTP.
manager_a=$(token manager.a "$(uv run --quiet --no-project python scripts/otp.py next manager.a)")
manager_b=$(token manager.b "$(uv run --quiet --no-project python scripts/otp.py next manager.b)")
# Mã riêng cho mỗi lần chạy: lần trước dọn dở thì không vướng UNIQUE (tenant_id, code).
code="smoke-$(date +%s)-$RANDOM"

insert_store='mutation($code: String!) {
  insert_app_supplies_commune_stores_one(object: {code: $code, name: "Kho kiểm thử"}) { id tenant_id } }'
out=$(gql "$admin_a" "$insert_store" "{\"code\":\"$code\"}" "$admin")
check "admin.a tạo kho, tenant lấy từ token" \
  "$(jq -r '.data.insert_app_supplies_commune_stores_one.tenant_id' <<<"$out")" xa-a
store_a=$(jq -r '.data.insert_app_supplies_commune_stores_one.id' <<<"$out")

# Thay đổi qua Hasura phải để lại nhật ký ghi sub của token và vai trò. psql chỉ thay :'id' trong SQL đọc từ stdin.
audit=$(docker compose exec -T postgres psql -qXAt --username hasura --dbname mortise -v id="$store_a" <<'SQL'
SELECT tenant_id || ' ' || op || ' ' || actor || ' ' || actor_role FROM core.audit_log
WHERE table_name = 'app_supplies_commune.stores' AND row_key ->> 'id' = :'id' ORDER BY id DESC LIMIT 1
SQL
)
check "Nhật ký ghi việc tạo kho với đúng người làm" "$audit" "xa-a INSERT $(sub_of "$admin_a") $admin"

check "admin.a không tự đặt được cột tenant_id" "$(errors "$(gql "$admin_a" 'mutation($code: String!) {
  insert_app_supplies_commune_stores_one(object: {code: $code, name: "x", tenant_id: "xa-b"}) { id } }' \
  "{\"code\":\"$code-spoof\"}" "$admin")")" true
check "user.a không tạo được kho (chỉ đọc)" "$(errors "$(gql "$user_a" "$insert_store" "{\"code\":\"$code-u\"}")")" true
check "manager.a không tạo được kho (chỉ đọc)" \
  "$(errors "$(gql "$manager_a" "$insert_store" "{\"code\":\"$code-m\"}" manager)")" true
check "user.a không tự nhận vai trò tenant_admin khi token không có" \
  "$(errors "$(gql "$user_a" "$insert_store" "{\"code\":\"$code-r\"}" "$admin")")" true
# Mã kho của xã B khác mã của xã A, để thử đặt vật tư của xã A vào một mã kho chỉ có ở xã B.
gql "$admin_b" "$insert_store" "{\"code\":\"$code-b\"}" "$admin" >/dev/null

stores='query($code: String!) { app_supplies_commune_stores(where: {code: {_like: $code}}, order_by: {code: asc}) {
  code } }'
codes() {
  gql "$1" "$stores" "{\"code\":\"$code%\"}" "${2:-user}" | jq -c '[.data.app_supplies_commune_stores[].code]'
}
check "user.a đọc được kho của xã mình, không thấy kho của xã B" "$(codes "$user_a")" "[\"$code\"]"
check "user.b không thấy kho của xã A" "$(codes "$user_b")" "[\"$code-b\"]"
check "manager.a đọc được kho của xã mình" "$(codes "$manager_a" manager)" "[\"$code\"]"

insert_item='mutation($store: String!, $code: String!, $quantity: numeric!) {
  insert_app_supplies_commune_items_one(object: {store_code: $store, code: $code, name: "Vật tư kiểm thử",
    unit: "cái", kind: "consumable", quantity: $quantity}) { id } }'
item() { # TOKEN KHO MÃ SỐ_LƯỢNG
  gql "$1" "$insert_item" "{\"store\":\"$2\",\"code\":\"$3\",\"quantity\":$4}" "$admin"
}
out=$(item "$admin_a" "$code" "$code" 5)
check "admin.a thêm vật tư vào kho của xã mình" "$(errors "$out")" false
item_a=$(jq -r '.data.insert_app_supplies_commune_items_one.id' <<<"$out")
check "Khóa ngoại ghép: admin.a không đặt được vật tư vào kho chỉ có ở xã B" \
  "$(errors "$(item "$admin_a" "$code-b" "$code" 1)")" true
check "Số lượng âm bị từ chối" "$(errors "$(item "$admin_a" "$code" "$code-neg" -1)")" true
update_item='mutation($code: String!) { update_app_supplies_commune_items(where: {code: {_eq: $code}},
  _set: {quantity: 0}) { affected_rows } }'
check "user.a không sửa được số lượng" "$(errors "$(gql "$user_a" "$update_item" "{\"code\":\"$code\"}")")" true
check "admin.a sửa được số lượng" "$(gql "$admin_a" "$update_item" "{\"code\":\"$code\"}" "$admin" |
  jq '.data.update_app_supplies_commune_items.affected_rows')" 1

# Quản trị xã B nhắm đúng id kho, vật tư của xã A: bộ lọc tenant của quyền sửa, xóa phải làm mutation không chạm dòng
# nào. Giá trị ghi khác giá trị đang có, để lần đọc lại phát hiện được nếu lọt.
cross() { # TÊN_MUTATION MUTATION ID: in affected_rows khi admin.b chạy
  gql "$admin_b" "$2" "{\"id\":\"$3\"}" "$admin" | jq ".data.$1.affected_rows"
}
check "admin.b không sửa được kho của xã A" "$(cross update_app_supplies_commune_stores 'mutation($id: uuid!) {
  update_app_supplies_commune_stores(where: {id: {_eq: $id}}, _set: {name: "bị sửa"}) { affected_rows } }' \
  "$store_a")" 0
check "admin.b không sửa được vật tư của xã A" "$(cross update_app_supplies_commune_items 'mutation($id: uuid!) {
  update_app_supplies_commune_items(where: {id: {_eq: $id}}, _set: {name: "bị sửa", quantity: 99}) {
    affected_rows } }' "$item_a")" 0
check "admin.b không xóa được vật tư của xã A" "$(cross delete_app_supplies_commune_items 'mutation($id: uuid!) {
  delete_app_supplies_commune_items(where: {id: {_eq: $id}}) { affected_rows } }' "$item_a")" 0
check "admin.b không xóa được kho của xã A" "$(cross delete_app_supplies_commune_stores 'mutation($id: uuid!) {
  delete_app_supplies_commune_stores(where: {id: {_eq: $id}}) { affected_rows } }' "$store_a")" 0
check "Kho và vật tư của xã A giữ nguyên sau các lần admin.b thử ghi" "$(gql "$admin_a" 'query($s: uuid!, $i: uuid!) {
  app_supplies_commune_stores_by_pk(id: $s) { name } app_supplies_commune_items_by_pk(id: $i) { name quantity } }' \
  "{\"s\":\"$store_a\",\"i\":\"$item_a\"}" "$admin" | jq -c '.data |
    [.app_supplies_commune_stores_by_pk.name, .app_supplies_commune_items_by_pk.name,
      (.app_supplies_commune_items_by_pk.quantity // empty | tonumber + 0)]')" '["Kho kiểm thử","Vật tư kiểm thử",0]'

delete_store='mutation($code: String!) { delete_app_supplies_commune_stores(where: {code: {_eq: $code}}) {
  affected_rows } }'
check "ON DELETE RESTRICT: không xóa được kho còn vật tư" \
  "$(errors "$(gql "$admin_a" "$delete_store" "{\"code\":\"$code\"}" "$admin")")" true

# Menu của gói (app.yaml, nạp khi cài): mỗi xã thấy mục của mình kèm cấu hình của thành phần. Hasura trả cả mục
# dành cho vai trò khác (roles); giao diện mới là nơi ẩn chúng.
menu='{ platform_menu_items(where: {app: {_eq: "supplies-commune"}}, order_by: {position: asc}) {
  tenant_id item component config roles } }'
check "Menu của gói: user.a thấy danh mục kho, hai biểu mẫu, trang đề nghị đã lập kèm cấu hình, chỉ của xã mình" \
  "$(gql "$user_a" "$menu" | jq -c '[.data.platform_menu_items[] | [.tenant_id, .item, .component,
    (.config.source // .config.submit.process // .config.submit.insert // .config.processes[0]), .roles]]')" \
  '[["xa-a","stores","catalog","app_supplies_commune_stores",null],["xa-a","supply-request","form","supply-request",null],["xa-a","item","form","app_supplies_commune_items",["tenant_admin"]],["xa-a","my-requests","cases","supply-request",null]]'
check "Menu của gói: user.b chỉ thấy mục của xã mình" \
  "$(gql "$user_b" "$menu" | jq -c '[.data.platform_menu_items[].tenant_id] | unique')" '["xa-b"]'

# Đề nghị cấp vật tư: user.a lập, chỉ người duyệt của xã A thấy, duyệt xong thì kết thúc ở nhánh đã duyệt.
title="Đề nghị kiểm thử $code"
request() { # TOKEN: lập đề nghị, in mã quy trình
  api "$1" POST "/processes/$process/instances" "{\"variables\": {\"title\": \"$title\", \"storeCode\": \"$code\",
    \"itemCode\": \"$code\", \"quantity\": 2, \"reason\": \"Kiểm thử tự động\"}}" | sed '$d' | jq -r .id
}
task_of() { # TOKEN MÃ_QUY_TRÌNH
  api "$1" GET /tasks | sed '$d' | jq -r --arg i "$2" '[.[] | select(.processInstanceId == $i) | .id][0] // ""'
}
complete() { # TOKEN TASK BIẾN_JSON: in mã HTTP
  api "$1" POST "/tasks/$2/complete" "{\"variables\": $3}" | tail -1
}
check "user.a không lập được đề nghị đặt sẵn quyết định của người duyệt" \
  "$(api "$user_a" POST "/processes/$process/instances" "{\"variables\": {\"title\": \"$title\", \"storeCode\": \"$code\",
    \"itemCode\": \"$code\", \"quantity\": 2, \"reason\": \"Kiểm thử tự động\", \"approved\": true}}" | tail -1)" 400
instance=$(request "$user_a")
task=$(task_of "$manager_a" "$instance")
check "Đề nghị của user.a tới bảng việc của manager.a" "$([[ -n "$task" ]] && echo yes)" yes
check "manager.b (xã B) không thấy đề nghị của xã A" "$(task_of "$manager_b" "$instance")" ""
# Trang "Đề nghị đã lập" (ADR 0032): user.a thấy đề nghị đang chờ bước duyệt; user.b (xã B) nhận 404.
case_of() { # TOKEN: mã HTTP rồi bước đang chờ, kết quả và tên biến của đề nghị, như người lập thấy
  api "$1" GET "/cases/$instance" | jq -rRs 'split("\n") | .[-1] + " " + ((.[0] | fromjson?) // {} |
    [(.current // [] | map(.step) | join(",")), .outcomeName, (.variables // {} | keys | join(","))] | join(" "))'
}
check "user.a theo dõi đề nghị của mình: đang chờ bước duyệt" "$(case_of "$user_a")" \
  "200 approve  itemCode,quantity,reason,storeCode,title"
check "user.b không thấy đề nghị của user.a" "$(case_of "$user_b" | cut -d' ' -f1)" 404
check "user.a không duyệt được (không có vai trò manager)" \
  "$(complete "$user_a" "$task" '{"approved": true, "comment": "x"}')" 403
check "manager.a duyệt đề nghị" "$(complete "$manager_a" "$task" '{"approved": true, "comment": "Đồng ý"}')" 204
check "Đề nghị kết thúc ở nhánh đã duyệt" \
  "$(api "$manager_a" GET "/instances/$instance" | sed '$d' | jq -r '"\(.ended) \(.outcome)"')" "true approved"
check "user.a thấy kết quả Đã duyệt, không thấy ý kiến hay quyết định của người duyệt" "$(case_of "$user_a")" \
  "200  Đã duyệt itemCode,quantity,reason,storeCode,title"

# Bốn mắt: manager.a lập đề nghị thì không tự duyệt được. Xã không còn người duyệt khác nên từ chối bằng chính
# manager.a không được; xóa hồ sơ thẳng ở Flowable trong máy chủ, như bài kiểm quy trình của gói xã, để bảng việc
# demo không tích hồ sơ do smoke để lại.
own=$(request "$manager_a")
out=$(api "$manager_a" POST "/tasks/$(task_of "$manager_a" "$own")/complete" '{"variables": {"approved": true}}')
check "Người lập là manager cũng không tự duyệt đề nghị của mình (bốn mắt)" \
  "$(tail -1 <<<"$out") $(sed '$d' <<<"$out" | jq -r '.error // "" | startswith("Quy tắc bốn mắt")')" "403 true"
curl -fsS -o /dev/null -X DELETE -u "rest-admin:$FLOWABLE_ADMIN_PASSWORD" \
  "http://127.0.0.1:${FLOWABLE_PORT:-8083}/flowable-rest/service/runtime/process-instances/$own"

# Dọn: vật tư trước, kho sau (RESTRICT).
gql "$admin_a" 'mutation($code: String!) {
  delete_app_supplies_commune_items(where: {store_code: {_like: $code}}) { affected_rows }
  delete_app_supplies_commune_stores(where: {code: {_like: $code}}) { affected_rows } }' \
  "{\"code\":\"$code%\"}" "$admin" >/dev/null
gql "$admin_b" "$delete_store" "{\"code\":\"$code-b\"}" "$admin" >/dev/null
check "Dọn dữ liệu kiểm thử" "$(codes "$admin_a" "$admin") $(codes "$admin_b" "$admin")" "[] []"

# Dữ liệu demo (seed/demo.yaml): xã A hai kho, bốn vật tư; xã B một kho, hai vật tư; user đọc được cả hai bảng.
# Chưa nạp thì bỏ qua, để smoke vẫn chạy được trên bản cài không có dữ liệu demo.
demo='{ app_supplies_commune_stores(where: {code: {_like: "KHO-%"}}) { code }
  app_supplies_commune_items(where: {store_code: {_like: "KHO-%"}}) { code } }'
counts() {
  gql "$1" "$demo" |
    jq -r '.data | "\(.app_supplies_commune_stores | length)/\(.app_supplies_commune_items | length)"'
}
if [[ "$(counts "$user_a")" != "0/0" ]]; then
  check "Dữ liệu demo xã A: 2 kho, 4 vật tư" "$(counts "$user_a")" "2/4"
  check "Dữ liệu demo xã B: 1 kho, 2 vật tư" "$(counts "$user_b")" "1/2"
else
  echo "SKIP  Dữ liệu demo chưa nạp (make seed-demo)"
fi
exit $fail
