#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm tin công khai và đăng ký nhận của quy trình rà soát qua cổng (ADR 0069): hồ sơ vượt ngưỡng được duyệt thì vào
# bước công khai; người duyệt xã A đăng tin, xã khác không đăng tin hộ được; xã B cùng tỉnh và tỉnh thấy tin, tỉnh khác
# không; xã B đăng ký nhận, xã A đăng ký cho một đơn vị thuộc xã (phải ghi tên đơn vị), tỉnh khác bị từ chối; xã B
# không thấy đăng ký của đơn vị khác hay thứ tự; xã A và tỉnh thấy danh sách xếp đơn vị thuộc xã A trước xã B; chỉ xã A
# ghi được tiêu chí phù hợp. Hết hạn thì đăng ký bị CSDL từ chối, bước trình chọn đăng ký đứng đầu, bước quyết định
# ghi nhận và hồ sơ được niêm phong. Chỉ chạy khi gói cài với thời hạn công khai ngắn, ví dụ make app-install
# APP=facilities-commune SETTINGS=publication_period=PT20S; thời hạn khác thì SKIP. smoke.sh của gói gọi tệp này; cần
# lõi đang chạy, đã `make seed`, `make seed-demo` và đã cài gói.
set -euo pipefail
cd "$(dirname "$0")/../../.."
# .env do `make env` sinh ra và không có trong repo, nên shellcheck không đọc theo.
set -a
# shellcheck source=/dev/null
source .env
set +a

base="${MORTISE_PUBLIC_URL:-http://localhost:9080}"
process=facilities-review
tenant=xa-a
wait_limit="${PUBLICATION_WAIT_LIMIT:-90}"
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

# api TOKEN METHOD ĐƯỜNG [THÂN_JSON]: thân phản hồi rồi mã HTTP ở dòng cuối.
api() {
  curl -sS -X "$2" "$base/v1/workflow$3" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' \
    ${4:+-d "$4"} -w '\n%{http_code}'
}

# gql TOKEN VAI_TRÒ QUERY [VARIABLES_JSON]: nguyên phản hồi GraphQL.
gql() {
  jq -cn --arg q "$3" --argjson v "${4:-{\}}" '{query: $q, variables: $v}' |
    curl -fsS -X POST "$base/v1/graphql" -H "Authorization: Bearer $1" -H "X-Hasura-Role: $2" \
      -H 'Content-Type: application/json' -d @-
}
# Lời báo lỗi đầu tiên của Hasura, hoặc "ok".
outcome() { jq -r '.errors[0].message // "ok"'; }

flowable() {
  curl -fsS -X "$1" -u "rest-admin:$FLOWABLE_ADMIN_PASSWORD" \
    "http://127.0.0.1:${FLOWABLE_PORT:-8083}/flowable-rest/service$2"
}

definition=$(flowable GET "/repository/process-definitions?key=$process&tenantId=$tenant&latest=true" |
  jq -r '.data[0].id // empty')
if [[ -z "$definition" ]]; then
  echo "FAIL  Chưa có quy trình $process cho $tenant: make app-install APP=facilities-commune"
  exit 1
fi
period=$(flowable GET "/repository/process-definitions/$definition/resourcedata" |
  sed -n 's:.*<timeDuration>\(.*\)</timeDuration>.*:\1:p')
if [[ ! "$period" =~ ^PT([0-9]+)S$ ]] || ((BASH_REMATCH[1] >= wait_limit)); then
  echo "SKIP  Thời hạn công khai đang deploy là '${period}': bỏ qua tin công khai và đăng ký nhận. Kiểm phần này:" \
    "make app-install APP=facilities-commune SETTINGS=publication_period=PT20S"
  exit 0
fi

user_a=$(token user.a)
user_b=$(token user.b)
manager_a=$(otp_token manager.a)
manager_b=$(otp_token manager.b)
manager_tinh=$(otp_token manager.tinh)
# Tenant tinh-khac bắt mọi tài khoản nhập OTP (ADR 0040), kể cả user.k.
user_k=$(otp_token user.k)

facility=$(gql "$manager_a" manager '{ app_facilities_commune_facilities(limit: 1, order_by: {code: asc}) { id } }' |
  jq -r '.data.app_facilities_commune_facilities[0].id // empty')
if [[ -z "$facility" ]]; then
  echo "FAIL  Xã A chưa có cơ sở nào: make seed-demo"
  exit 1
fi

case_id=$(api "$user_a" POST "/processes/$process/instances" \
  "{\"variables\": {\"title\": \"Tin công khai kiểm thử $(date +%s)\", \"facilityId\": \"$facility\", \"excessM2\": 420}}" |
  sed '$d' | jq -r .id)
task=$(api "$manager_a" GET /tasks | sed '$d' | jq -r --arg i "$case_id" '[.[] | select(.processInstanceId == $i)][0].id')
check "Người duyệt xã A duyệt để công khai" \
  "$(api "$manager_a" POST "/tasks/$task/complete" '{"variables": {"approved": true, "comment": "Công khai"}}' |
    tail -1)" 204

# Dọn: tin, đăng ký và đánh giá của hồ sơ thử không có quyền xóa qua Hasura (đơn đã gửi là hồ sơ), nên xóa thẳng
# trong CSDL chỉ trong bài kiểm; để lại thì mục "Tin công khai" của demo tích tin sau mỗi lần chạy.
# shellcheck disable=SC2329 # gọi qua trap EXIT
cleanup() {
  docker compose exec -T postgres psql -qXAt --username hasura --dbname mortise -v id="$case_id" >/dev/null <<'SQL'
DELETE FROM app_facilities_commune.request_assessments a USING app_facilities_commune.receive_requests r
    WHERE a.request_id = r.id AND r.case_id = :'id';
DELETE FROM app_facilities_commune.receive_requests WHERE case_id = :'id';
DELETE FROM app_facilities_commune.notices WHERE case_id = :'id';
SQL
  [[ "$(api "$manager_a" GET "/instances/$case_id" | sed '$d' | jq -r .ended)" == true ]] ||
    flowable DELETE "/runtime/process-instances/$case_id" >/dev/null
}
trap cleanup EXIT

check "Hồ sơ đang công khai hiện trong danh sách chọn của biểu mẫu đăng tin của xã A" \
  "$(gql "$manager_a" manager '{ app_facilities_commune_publication_cases { case_id } }' |
    jq -r --arg i "$case_id" '[.data.app_facilities_commune_publication_cases[] | select(.case_id == $i)] | length')" 1

# shellcheck disable=SC2016 # biến GraphQL, không phải biến shell
post_notice='mutation($c: String!, $f: uuid!) { insert_app_facilities_commune_notices(objects: {case_id: $c,
  facility_id: $f, usage: "Làm việc", offered_m2: 420, layout: "Sơ đồ tầng 2 ở giấy tờ của cơ sở",
  portal_url: "https://example.invalid/tin/1"}) { affected_rows } }'
vars=$(jq -cn --arg c "$case_id" --arg f "$facility" '{c: $c, f: $f}')
check "Người duyệt xã B không đăng tin cho hồ sơ của xã A" \
  "$(gql "$manager_b" manager "$post_notice" "$vars" | outcome)" \
  "Check constraint violation. Hồ sơ này chưa vào bước công khai của xã bạn: chỉ đăng tin cho hồ sơ đang công khai."
check "Người duyệt xã A đăng tin cho hồ sơ đang công khai" "$(gql "$manager_a" manager "$post_notice" "$vars" |
  jq -r '.data.insert_app_facilities_commune_notices.affected_rows // .errors[0].message')" 1

# shellcheck disable=SC2016
board='query($c: String!) { app_facilities_commune_notice_board(where: {case_id: {_eq: $c}}) { tenant_id status
  notice_text } }'
seen() { gql "$1" "$2" "$board" "{\"c\": \"$case_id\"}" | jq -r '[.data.app_facilities_commune_notice_board[] |
  "\(.tenant_id) \(.status)"] | join(",")'; }
check "Xã B (cùng tỉnh) thấy tin của xã A, đang nhận đăng ký" "$(seen "$user_b" user)" "xa-a open"
check "Người quyết định của tỉnh thấy tin của xã A" "$(seen "$manager_tinh" manager)" "xa-a open"
check "Tỉnh khác không thấy tin của xã A" "[$(seen "$user_k" user)]" "[]"
check "Mẫu tin có đủ năm nội dung của điểm a và nơi đăng tải" \
  "$(gql "$user_b" user "$board" "{\"c\": \"$case_id\"}" | jq -r '.data.app_facilities_commune_notice_board[0].notice_text' |
    grep -cE '^(1\. Địa chỉ|2\. Công năng|3\. Phần diện tích.*420,00 m²|4\. Sơ đồ|5\. Thông tin khác|Nơi đăng tải.*https://example.invalid/tin/1)')" 6

# shellcheck disable=SC2016
register='mutation($o: app_facilities_commune_receive_requests_insert_input!) {
  insert_app_facilities_commune_receive_requests(objects: [$o]) { affected_rows } }'
request() { jq -cn --arg c "$case_id" --argjson extra "$1" '{o: ({case_id: $c, explanation: "Thuyết minh kiểm thử"} + $extra)}'; }
check "Xã B đăng ký nhận 200 m² làm nhà văn hóa" "$(gql "$user_b" user "$register" \
  "$(request '{"purpose": "Nhà văn hóa", "requested_m2": 200}')" |
  jq -r '.data.insert_app_facilities_commune_receive_requests.affected_rows // .errors[0].message')" 1
check "Xã A đăng ký từ chính xã mà không ghi tên đơn vị bị từ chối" "$(gql "$user_a" user "$register" \
  "$(request '{"purpose": "Lớp học", "requested_m2": 100}')" | outcome)" \
  "Check constraint violation. Đăng ký từ chính xã đăng tin phải ghi tên đơn vị thuộc xã có nhu cầu tiếp nhận."
check "Xã A đăng ký cho đơn vị thuộc xã" "$(gql "$user_a" user "$register" \
  "$(request '{"unit_name": "Trường mầm non xã A", "purpose": "Lớp học", "requested_m2": 100}')" |
  jq -r '.data.insert_app_facilities_commune_receive_requests.affected_rows // .errors[0].message')" 1
check "Tỉnh khác đăng ký bị từ chối" "$(gql "$user_k" user "$register" \
  "$(request '{"purpose": "Kho", "requested_m2": 50}')" | outcome | cut -c1-60)" \
  "Check constraint violation. Chỉ đơn vị trong cùng tỉnh với xã"

# shellcheck disable=SC2016
ranked='query($c: String!) { app_facilities_commune_request_board(where: {case_id: {_eq: $c}}, order_by: {rank: asc})
  { id tenant_id rank choice } }'
list() { gql "$1" "$2" "$ranked" "{\"c\": \"$case_id\"}"; }
check "Xã B chỉ thấy đăng ký của mình, không thấy thứ tự" \
  "$(list "$user_b" user | jq -c '[.data.app_facilities_commune_request_board[] | [.tenant_id, .rank, .choice]]')" \
  '[["xa-b",null,null]]'
check "Xã B không đọc được đăng ký của xã A ở bảng gốc" \
  "$(gql "$user_b" user '{ app_facilities_commune_receive_requests { tenant_id } }' |
    jq -r '[.data.app_facilities_commune_receive_requests[].tenant_id] | unique | join(",")')" xa-b
check "Xã A thấy thứ tự: đơn vị thuộc xã A (bậc 2) rồi xã B (bậc 3)" \
  "$(list "$manager_a" manager | jq -c '[.data.app_facilities_commune_request_board[] | [.rank, .tenant_id]]')" \
  '[[1,"xa-a"],[2,"xa-b"]]'
check "Người quyết định của tỉnh thấy cùng thứ tự" \
  "$(list "$manager_tinh" manager | jq -c '[.data.app_facilities_commune_request_board[] | .tenant_id]')" \
  '["xa-a","xa-b"]'

b_request=$(list "$manager_a" manager | jq -r '.data.app_facilities_commune_request_board[] | select(.tenant_id == "xa-b") | .id')
# shellcheck disable=SC2016
assess='mutation($r: uuid!) { insert_app_facilities_commune_request_assessments(objects: {request_id: $r,
  purpose_fit: "fit", area_fit: "fit"}) { affected_rows } }'
check "Người duyệt xã B không ghi tiêu chí cho đăng ký vào tin của xã A" \
  "$(gql "$manager_b" manager "$assess" "{\"r\": \"$b_request\"}" | outcome)" \
  "Check constraint violation. Chỉ xã đăng tin ghi được tiêu chí phù hợp cho đăng ký vào tin của mình."
check "Người duyệt xã A ghi đăng ký của xã B phù hợp: xã B lên đầu (tiêu chí thứ nhất trước bậc)" \
  "$(gql "$manager_a" manager "$assess" "{\"r\": \"$b_request\"}" >/dev/null
    list "$manager_a" manager | jq -c '[.data.app_facilities_commune_request_board[] | .tenant_id]')" '["xa-b","xa-a"]'

waited=0
submit_task() {
  api "$manager_a" GET /tasks | sed '$d' |
    jq -r --arg i "$case_id" '[.[] | select(.processInstanceId == $i and .step == "submit")][0].id // empty'
}
while [[ -z "$(submit_task)" ]] && ((waited < wait_limit)); do
  sleep 5
  waited=$((waited + 5))
done
if [[ -z "$(submit_task)" ]]; then
  echo "FAIL  Hết ${wait_limit} giây hồ sơ vẫn đang công khai"
  exit 1
fi
check "Hết hạn: xã B đăng ký thêm bị CSDL từ chối" "$(gql "$user_b" user "$register" \
  "$(request '{"purpose": "Kho", "requested_m2": 20}')" | outcome)" \
  "Check constraint violation. Đã hết thời hạn công khai: không nhận đăng ký sau hạn."
check "Hết hạn: tin hiện đã hết hạn" "$(seen "$user_b" user)" "xa-a closed"

first=$(list "$manager_a" manager | jq -r '.data.app_facilities_commune_request_board[0].choice')
vars=$(jq -cn --arg r "$first" '{variables: {recipient: $r, submitted: true}}')
check "Bước trình: chọn đăng ký đứng đầu danh sách" "$(api "$manager_a" POST "/tasks/$(submit_task)/complete" "$vars" |
  tail -1)" 204
decide=$(api "$manager_a" GET /tasks | sed '$d' |
  jq -r --arg i "$case_id" '[.[] | select(.processInstanceId == $i and .step == "decide")][0]')
check "Bước quyết định thấy đơn vị đã chọn" "$(jq -r '.variables.recipient' <<<"$decide" | cut -c1-20)" \
  "1. Xã B (Tỉnh Mẫu):"
check "Ghi nhận quyết định: hồ sơ kết thúc và được niêm phong" \
  "$(api "$manager_a" POST "/tasks/$(jq -r .id <<<"$decide")/complete" \
    '{"variables": {"decision": "Điều chuyển cho xã B", "decided": true}}' | tail -1) $(
    api "$manager_a" GET "/instances/$case_id" | sed '$d' | jq -r '"\(.outcome) \(.seal.hash // "" | test("^[0-9a-f]{64}$"))"')" \
  "204 decided true"

exit $fail
