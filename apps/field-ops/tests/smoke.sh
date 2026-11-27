#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm tra gói qua cổng APISIX sau khi `make app-install APP=field-ops`: tenant do token quyết định, khóa ngoại ghép
# chặn việc nối vào khách hàng của tenant khác, nhân viên lập và cập nhật phiếu nhưng không sửa được danh mục, cột sửa
# cuối do CSDL đặt nên lệnh sửa mang giá trị cũ không ghi đè (ADR 0067), số phiếu quá hạn của bảng điều hành, ảnh đính
# kèm phiếu (ADR 0041), nghiệm thu bốn mắt, luật sản lượng thấp mở việc sửa chữa cho đúng tenant (ADR 0018), menu theo
# tenant.
#
# Tenant: chạy bằng tài khoản `admin.dmt`, `user.dmt`, `manager.dmt` của mẫu cài `dien-mat-troi` (#244) khi bản cài có
# chúng; bản cài chính quyền không có tenant `dmt`, khi đó chạy bằng tài khoản của xã A (`xa-a`), vì bộ cài nạp gói cho
# mọi tenant. Tenant đối chứng luôn là xã B, có trên cả hai bản cài. Có dữ liệu demo của `dmt` thì kiểm số dòng.
# Tệp này chỉ CI và người phát triển chạy, bộ cài gói không đọc tests/ (ADR 0022). Tự dọn dữ liệu đã tạo. Cần lõi đang
# chạy và đã `make seed`.
#
# SC2016: biến GraphQL ($code) phải nằm trong nháy đơn để shell không mở rộng; giá trị đi qua trường variables.
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
fail=0

check() {
  if [[ "$2" == "$3" ]]; then echo "PASS  $1"; else echo "FAIL  $1 (muốn: $3, nhận: $2)"; fail=1; fi
}
token() {
  curl -fsS "$base/auth/realms/mortise/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=mortise-test \
    -d "username=$1" -d "password=$DEMO_USER_PASSWORD" ${2:+-d "totp=$2"} | jq -r .access_token
}
otp_token() { token "$1" "$(uv run --quiet --no-project python scripts/otp.py next "$1")"; }
gql() {
  jq -cn --arg q "$2" --argjson v "${3:-{\}}" '{query: $q, variables: $v}' |
    curl -fsS -X POST "$base/v1/graphql" -H "Authorization: Bearer $1" -H "X-Hasura-Role: ${4:-user}" \
      -H 'Content-Type: application/json' -d @-
}
api() {
  curl -sS -X "$2" "$base/v1/workflow$3" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' \
    ${4:+-d "$4"} -w '\n%{http_code}'
}
errors() { jq 'has("errors")' <<<"$1"; }
# pick TRƯỜNG: in một trường của data trong phản hồi GraphQL ở stdin.
pick() { jq -r ".data.$1"; }

if admin_t=$(token admin.dmt 2>/dev/null) && [[ -n "$admin_t" && "$admin_t" != null ]]; then
  tenant=dmt suffix=dmt
else
  tenant=xa-a suffix=a
  admin_t=$(token admin.a)
  echo "NOTE  Bản cài không có tài khoản admin.dmt (mẫu cài dien-mat-troi, #244): chạy trên tenant xa-a"
fi
user_t=$(token "user.$suffix")
manager_t=$(otp_token "manager.$suffix")
user_b=$(token user.b)
admin_b=$(token admin.b)
manager_b=$(otp_token manager.b)
code="smoke-$(date +%s)-$RANDOM"

# Khách hàng, điểm, thiết bị: quản trị ghi, nhân viên chỉ đọc.
customer='mutation($code: String!) { insert_app_field_ops_customers_one(object: {code: $code, name: "Khách kiểm thử"}) {
  tenant_id } }'
check "Quản trị tạo khách hàng, tenant lấy từ token" \
  "$(gql "$admin_t" "$customer" "{\"code\":\"$code\"}" "$admin" | pick insert_app_field_ops_customers_one.tenant_id)" \
  "$tenant"
check "Nhân viên không tạo được khách hàng" "$(errors "$(gql "$user_t" "$customer" "{\"code\":\"$code-u\"}")")" true
site='mutation($code: String!, $customer: String!, $lat: numeric, $lon: numeric) {
  insert_app_field_ops_sites_one(object: {code: $code, customer_code: $customer, name: "Điểm kiểm thử",
    latitude: $lat, longitude: $lon, status: "operating"}) { status } }'
check "Quản trị tạo điểm lắp đặt có tọa độ" "$(gql "$admin_t" "$site" \
  "{\"code\":\"$code\",\"customer\":\"$code\",\"lat\":20.44,\"lon\":106.41}" "$admin" |
  jq -r '.data.insert_app_field_ops_sites_one.status')" operating
check "Điểm chỉ có vĩ độ, thiếu kinh độ bị từ chối" "$(errors "$(gql "$admin_t" "$site" \
  "{\"code\":\"$code-half\",\"customer\":\"$code\",\"lat\":20.44,\"lon\":null}" "$admin")")" true
check "Khóa ngoại ghép: xã B không tạo được điểm trỏ vào khách hàng của tenant khác" \
  "$(errors "$(gql "$admin_b" "$site" \
  "{\"code\":\"$code-b\",\"customer\":\"$code\",\"lat\":null,\"lon\":null}" "$admin")")" true
sensor="smoke-$RANDOM"
device='mutation($site: String!, $code: String!, $name: String!) { insert_app_field_ops_devices_one(object: {
  site_code: $site, code: $code, kind: "meter", device_name: $name}) { device_name } }'
check "Quản trị thêm công tơ tại điểm" "$(gql "$admin_t" "$device" \
  "{\"site\":\"$code\",\"code\":\"CT\",\"name\":\"$sensor\"}" "$admin" | pick insert_app_field_ops_devices_one.device_name)" \
  "$sensor"
check "Tên thiết bị trùng trong tenant bị từ chối" "$(errors "$(gql "$admin_t" "$device" \
  "{\"site\":\"$code\",\"code\":\"CT2\",\"name\":\"$sensor\"}" "$admin")")" true

# Phiếu công việc: nhân viên lập, cập nhật; số quá hạn của bảng điều hành tăng đúng một.
summary='{ app_field_ops_work_order_summary { open_count overdue_count } }'
before=$(gql "$user_t" "$summary" | jq -c '.data.app_field_ops_work_order_summary[0] | [.open_count, .overdue_count]')
order='mutation($code: String!, $site: String!, $due: date) { insert_app_field_ops_work_orders_one(object: {
  code: $code, site_code: $site, kind: "repair", title: "Kiểm tra công tơ", due_on: $due}) { id status updated_at } }'
out=$(gql "$user_t" "$order" "{\"code\":\"$code\",\"site\":\"$code\",\"due\":\"$(date -u -d yesterday +%F)\"}")
order_id=$(jq -r '.data.insert_app_field_ops_work_orders_one.id' <<<"$out")
version=$(jq -r '.data.insert_app_field_ops_work_orders_one.updated_at' <<<"$out")
check "Nhân viên lập phiếu sửa chữa, trạng thái mặc định Mới lập" \
  "$(jq -r '.data.insert_app_field_ops_work_orders_one.status' <<<"$out")" open
after=$(gql "$user_t" "$summary" | jq -c '.data.app_field_ops_work_order_summary[0] | [.open_count, .overdue_count]')
check "Bảng điều hành: còn phải làm và quá hạn cùng tăng một" \
  "$(jq -cn --argjson a "$before" --argjson b "$after" '[$b[0] - $a[0], $b[1] - $a[1]]')" "[1,1]"
check "Xã B không thấy phiếu của tenant khác" "$(gql "$user_b" 'query($id: uuid!) {
  app_field_ops_work_orders_by_pk(id: $id) { id } }' "{\"id\":\"$order_id\"}" | pick app_field_ops_work_orders_by_pk)" null
update='mutation($id: uuid!, $v: timestamptz!) { update_app_field_ops_work_orders(where: {id: {_eq: $id},
  updated_at: {_eq: $v}}, _set: {status: "in_progress"}) { affected_rows returning { updated_at } } }'
out=$(gql "$user_t" "$update" "{\"id\":\"$order_id\",\"v\":\"$version\"}")
check "Nhân viên cập nhật trạng thái với đúng phiên bản đang xem" \
  "$(jq -r '.data.update_app_field_ops_work_orders.affected_rows' <<<"$out")" 1
check "CSDL đặt lại cột sửa cuối, nên lệnh sửa mang phiên bản cũ không ghi đè" \
  "$(gql "$user_t" "$update" "{\"id\":\"$order_id\",\"v\":\"$version\"}" | pick update_app_field_ops_work_orders.affected_rows)" 0
check "Nhân viên không chuyển được phiếu sang điểm khác" "$(errors "$(gql "$user_t" 'mutation($id: uuid!) {
  update_app_field_ops_work_orders(where: {id: {_eq: $id}}, _set: {site_code: "khac"}) { affected_rows } }' \
  "{\"id\":\"$order_id\"}")")" true

# Ảnh đính kèm phiếu (ADR 0041): tệp qua /v1/files, dòng nối do nhân viên gắn; xã B không thấy dòng nối.
image=$(printf 'anh-hien-truong-%s' "$code")
body=$(printf '%s' "$image" | curl -fsS -X POST -H "Authorization: Bearer $user_t" -H 'Content-Type: image/png' \
  --data-binary @- "$base/v1/files?name=anh-hien-truong.png")
file_id=$(jq -r .id <<<"$body")
link='mutation($w: uuid!, $f: uuid!) { insert_app_field_ops_work_order_documents_one(object: {work_order_id: $w,
  file_id: $f, note: "Ảnh hiện trường"}) { tenant_id } }'
check "Nhân viên gắn ảnh vào phiếu" \
  "$(gql "$user_t" "$link" "{\"w\":\"$order_id\",\"f\":\"$file_id\"}" | pick insert_app_field_ops_work_order_documents_one.tenant_id)" \
  "$tenant"
docs='query($w: uuid!) { app_field_ops_work_order_documents(where: {work_order_id: {_eq: $w}}) { file_id } }'
check "Người điều phối thấy ảnh; xã B không thấy" "$(gql "$manager_t" "$docs" "{\"w\":\"$order_id\"}" |
  jq -c '[.data.app_field_ops_work_order_documents[].file_id]') $(gql "$user_b" "$docs" "{\"w\":\"$order_id\"}" |
  jq -c '[.data.app_field_ops_work_order_documents[].file_id]')" "[\"$file_id\"] []"

# Nghiệm thu bốn mắt (bpmn/work-acceptance.bpmn20.xml): nhân viên đề nghị, người điều phối cùng tenant xác nhận.
request() {
  api "$1" POST /processes/work-acceptance/instances "{\"variables\": {\"title\": \"Kiểm tra công tơ\",
    \"workOrderId\": \"$order_id\", \"workOrderCode\": \"$code\", \"siteCode\": \"$code\"}}" | sed '$d' | jq -r .id
}
task_of() {
  api "$1" GET /tasks | sed '$d' | jq -r --arg i "$2" '[.[] | select(.processInstanceId == $i) | .id][0] // ""'
}
complete() { api "$1" POST "/tasks/$2/complete" "{\"variables\": $3}" | tail -1; }
instance=$(request "$user_t")
task=$(task_of "$manager_t" "$instance")
check "Đề nghị nghiệm thu tới bảng việc của người điều phối" "$([[ -n "$task" ]] && echo yes)" yes
check "Người điều phối xã B không thấy đề nghị" "$(task_of "$manager_b" "$instance")" ""
check "Nhân viên không tự xác nhận được" "$(complete "$user_t" "$task" '{"accepted": true, "comment": "x"}')" 403
check "Người điều phối xác nhận nghiệm thu" \
  "$(complete "$manager_t" "$task" '{"accepted": true, "comment": "Đạt"}')" 204
check "Hồ sơ kết thúc ở nhánh đã nghiệm thu" \
  "$(api "$manager_t" GET "/instances/$instance" | sed '$d' | jq -r '"\(.ended) \(.outcome)"')" "true accepted"
own=$(request "$manager_t")
check "Người điều phối không tự xác nhận đề nghị của chính mình (bốn mắt)" \
  "$(complete "$manager_t" "$(task_of "$manager_t" "$own")" '{"accepted": true, "comment": "x"}')" 403
curl -fsS -o /dev/null -X DELETE -u "rest-admin:$FLOWABLE_ADMIN_PASSWORD" \
  "http://127.0.0.1:${FLOWABLE_PORT:-8083}/flowable-rest/service/runtime/process-instances/$own"

# Luật sản lượng thấp (rules/low-output.yaml): công suất dưới 1 kW liên tục 10 phút thì người điều phối có việc sửa
# chữa.
# Số đo qua MQTT bằng tài khoản thiết bị cấp lúc chạy, observedAt lùi về trước nên không phải chờ 10 phút; thiết bị chỉ
# nhận số đo thấp, để số đo bình thường không cắt chuỗi.
sensor_password=$(openssl rand -hex 16)
scripts/device.sh add "$tenant" "$sensor" "$sensor_password" >/dev/null
power() { # GIÁ_TRỊ GIÂY_LÙI
  docker compose exec -T mosquitto mosquitto_pub -u "$tenant.$sensor" -P "$sensor_password" -q 1 \
    -t "mortise/$tenant/$sensor" \
    -m "{\"observedAt\": \"$(date -u -d "-$2 seconds" +%FT%TZ)\", \"measurements\": {\"power\": $1}}" \
    >/dev/null 2>&1 || true
}
repairs() {
  curl -fsS -H "Authorization: Bearer $1" "$base/v1/workflow/tasks" |
    jq -r --arg d "$sensor" '.[] | select(.process == "site-repair" and .variables.device == $d) | .id'
}
power 0.3 610
sleep 1
# Cầu nối đọc lại luật mỗi 30 giây, nên ngay sau khi cài gói có thể chưa thấy luật: gửi lại tới khi có việc.
opened=""
for _ in $(seq 1 22); do
  power 0.2 0
  opened=$(repairs "$manager_t" | head -1)
  [[ -n "$opened" ]] && break
  sleep 2
done
check "Sản lượng thấp 10 phút: người điều phối có việc sửa chữa" "$([[ -n "$opened" ]] && echo yes)" yes
check "Chỉ một việc sửa chữa dù sản lượng vẫn thấp" "$(repairs "$manager_t" | grep -c . || true)" 1
check "Người điều phối xã B không thấy việc sửa chữa" "$(repairs "$manager_b" | grep -c . || true)" 0
check "Bảng điều hành: công suất của thiết bị đọc được qua context-api" \
  "$(curl -fsS -H "Authorization: Bearer $user_t" "$base/v1/context/entities?type=Device&attrs=power&limit=51" |
    jq -r --arg d "urn:ngsi-ld:Device:$sensor" '.[] | select(.id == $d) | .power.value')" 0.2
for task in $(repairs "$manager_t"); do
  complete "$manager_t" "$task" '{"finding": "Kiểm thử tự động", "handled": true}' >/dev/null
done
check "Ghi kết quả xong, không còn việc sửa chữa của thiết bị thử" "$(repairs "$manager_t" | grep -c . || true)" 0
scripts/device.sh remove "$tenant" "$sensor" >/dev/null

menu='{ platform_menu_items(where: {app: {_eq: "field-ops"}}, order_by: {position: asc}) { tenant_id item } }'
check "Menu của gói: tám mục, chỉ của tenant mình" "$(gql "$user_t" "$menu" | jq -c '[.data.platform_menu_items[] |
  .tenant_id] | [unique, length]')" "[[\"$tenant\"],8]"

# Dọn theo khóa ngoại (RESTRICT): phiếu (kéo theo dòng ảnh), thiết bị, điểm, khách hàng.
gql "$admin_t" 'mutation($code: String!) {
  delete_app_field_ops_work_orders(where: {code: {_like: $code}}) { affected_rows }
  delete_app_field_ops_devices(where: {site_code: {_like: $code}}) { affected_rows }
  delete_app_field_ops_sites(where: {code: {_like: $code}}) { affected_rows }
  delete_app_field_ops_customers(where: {code: {_like: $code}}) { affected_rows } }' \
  "{\"code\":\"$code%\"}" "$admin" >/dev/null
check "Dọn dữ liệu kiểm thử" "$(gql "$admin_t" 'query($code: String!) { app_field_ops_customers(where: {code:
  {_like: $code}}) { code } }' "{\"code\":\"$code%\"}" "$admin" | jq -c '.data.app_field_ops_customers')" "[]"

# Dữ liệu demo của tenant dmt (seed/dien-mat-troi.yaml): ba khách hàng, bốn điểm, năm thiết bị, bốn phiếu.
demo='{ c: app_field_ops_customers(where: {code: {_like: "KH-%"}}) { code }
  s: app_field_ops_sites(where: {code: {_like: "D0%"}}) { code }
  d: app_field_ops_devices(where: {site_code: {_like: "D0%"}}) { code }
  w: app_field_ops_work_orders(where: {code: {_like: "PCV-%"}}) { code } }'
counts=$(gql "$user_t" "$demo" | jq -r '.data | "\(.c | length)/\(.s | length)/\(.d | length)/\(.w | length)"')
if [[ "$tenant" == dmt && "$counts" != "0/0/0/0" ]]; then
  check "Dữ liệu demo của dmt: 3 khách hàng, 4 điểm, 5 thiết bị, 4 phiếu" "$counts" "3/4/5/4"
else
  echo "SKIP  Dữ liệu demo của dmt chưa nạp hay bản cài không có tenant dmt"
fi
exit $fail
