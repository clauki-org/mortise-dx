#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm quy trình rà soát của gói (bpmn/facilities-review.bpmn20.xml) qua cổng, bằng API quy trình như giao
# diện: phần vượt trên ngưỡng thì sau khi duyệt chờ hết thời hạn công khai rồi mới sang bước trình và bước quyết
# định, từ ngưỡng trở xuống thì duyệt xong là kết thúc; người lập không tự duyệt; biến gửi kèm khi lập hay khi duyệt
# không đổi được nhánh. Bảng phân cấp (ADR 0028): quản trị tỉnh đổi dòng của xã A thì hồ sơ lập sau có bước quyết
# định ở vai trò mới, hồ sơ đã lập giữ vai trò cũ, và bước quyết định cần OTP. Hồ sơ vượt dòng `province` (trên
# 1000 m²) có bước quyết định ở người duyệt của tỉnh (ADR 0029): manager.tinh chỉ thấy bước đó, người của xã khác và
# tỉnh khác nhận 404. Trường của bước (ADR 0031): người lập hay người trình không gửi sẵn được nội dung quyết định.
# Ngưỡng 300 m² là giá trị trong app.yaml; thời hạn công khai đọc từ quy trình đã deploy (ADR 0019): chỉ chờ hết hạn
# khi gói được cài với thời hạn ngắn, ví dụ make app-install APP=facilities-commune SETTINGS=publication_period=PT20S,
# còn không thì báo SKIP phần đó. Mọi hồ sơ tạo ra đều được đưa tới kết thúc hoặc bị xóa; dòng của xã A được đặt lại
# về manager.
# smoke.sh của gói gọi tệp này; cần lõi đang chạy, đã `make seed` và đã cài gói.
set -euo pipefail
cd "$(dirname "$0")/../../.."
# .env do `make env` sinh ra và không có trong repo, nên shellcheck không đọc theo.
set -a
# shellcheck source=/dev/null
source .env
set +a

base="${MORTISE_PUBLIC_URL:-http://localhost:9080}"
process=facilities-review
# Xã của user.a và manager.a (scripts/seed.sh).
tenant=xa-a
# Chờ hết thời hạn công khai tối đa chừng này giây; thời hạn của demo và CI là PT20S.
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

# api TOKEN METHOD ĐƯỜNG [THÂN_JSON]: in thân phản hồi rồi mã HTTP ở dòng cuối.
api() {
  curl -sS -X "$2" "$base/v1/workflow$3" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' \
    ${4:+-d "$4"} -w '\n%{http_code}'
}

# file VARIABLES_JSON: lập hồ sơ bằng user.a, in mã quy trình.
file() {
  api "$user" POST "/processes/$process/instances" "{\"variables\": $1}" | sed '$d' | jq -r .id
}

# pending INSTANCE FIELD [TOKEN]: trường FIELD của các việc đang chờ của hồ sơ mà TOKEN thấy (mặc định manager.a),
# nối bằng dấu phẩy; rỗng nếu không thấy việc nào.
pending() {
  api "${3:-$manager}" GET /tasks | sed '$d' |
    jq -r --arg i "$1" --arg f "$2" '[.[] | select(.processInstanceId == $i) | .[$f]] | join(",")'
}
step_of() { pending "$1" step "${2:-}"; }
task_of() { pending "$1" id "${2:-}"; }
# Vai trò workflow-api đặt cho bước quyết định lúc lập hồ sơ, đọc trên việc đang chờ mà manager.a thấy.
decider_of() {
  api "$manager" GET /tasks | sed '$d' |
    jq -r --arg i "$1" '[.[] | select(.processInstanceId == $i) | .variables.authority_decide][0] // ""'
}

# complete TOKEN INSTANCE VARIABLES_JSON: TOKEN hoàn thành bước đang chờ của hồ sơ mà chính TOKEN thấy, in mã HTTP.
complete() {
  api "$1" POST "/tasks/$(task_of "$2" "$1")/complete" "{\"variables\": $3}" | tail -1
}

status() { api "$manager" GET "/instances/$1" | sed '$d' | jq -r '"\(.ended) \(.outcome)"'; }

# set_decider TOKEN VAI_TRÒ: đổi vai trò của dòng gốc bước quyết định của xã A qua GraphQL với vai trò tenant_admin,
# như quản trị tỉnh làm; in affected_rows, hoặc mã lỗi của Hasura.
set_decider() {
  # shellcheck disable=SC2016 # biến GraphQL, không phải biến shell
  jq -nc --arg t "$tenant" --arg p "$process" --arg r "$2" '{query: "mutation($t: String!, $p: String!, $r: String!) {
    update_core_step_authorities(where: {tenant_id: {_eq: $t}, process: {_eq: $p}, step: {_eq: \"decide\"},
      rule: {_eq: \"default\"}}, _set: {role: $r}) { affected_rows } }", variables: {t: $t, p: $p, r: $r}}' |
    curl -sS -X POST "$base/v1/graphql" -H "Authorization: Bearer $1" -H 'X-Hasura-Role: tenant_admin' \
      -H 'Content-Type: application/json' -d @- |
    jq -r '.data.update_core_step_authorities.affected_rows // .errors[0].extensions.code'
}
# Đặt lại dòng của xã A về manager như tệp mặc định của gói. Cài lại gói không ghi đè dòng đã đổi, nên lần chạy dừng
# giữa chừng mà không đặt lại sẽ để bước quyết định của xã A ở vai trò khác cho tới khi có người sửa.
restore_decider() { set_decider "$(token admin.tinh)" manager; }

# Gọi thẳng Flowable trong máy chủ bằng tài khoản rest-admin, như scripts/smoke.sh của lõi, chỉ ở hai việc API quy
# trình qua cổng không làm được: đọc thời hạn công khai đã deploy, và xóa hồ sơ mà bài không đưa tới kết thúc được.
flowable() {
  curl -fsS -X "$1" -u "rest-admin:$FLOWABLE_ADMIN_PASSWORD" \
    "http://127.0.0.1:${FLOWABLE_PORT:-8083}/flowable-rest/service$2"
}

# otp_token TÊN: token của người phải đăng nhập kèm mã OTP (ADR 0011).
otp_token() { token "$1" "$(uv run --quiet --no-project python scripts/otp.py next "$1")"; }

user=$(token user.a)
# Người duyệt phải gửi kèm mã OTP (ADR 0011); một token dùng cho cả bài để không tốn mã.
manager=$(otp_token manager.a)
# Người duyệt của tỉnh (tenant cha của xã A), của xã B cùng tỉnh, và của tỉnh khác (scripts/seed.sh).
manager_tinh=$(otp_token manager.tinh)
manager_b=$(otp_token manager.b)
manager_k=$(otp_token manager.k)
title="Rà soát kiểm thử $(date +%s)"
admin_a=$(token admin.a)

definition=$(flowable GET "/repository/process-definitions?key=$process&tenantId=$tenant&latest=true" |
  jq -r '.data[0].id // empty')
if [[ -z "$definition" ]]; then
  echo "FAIL  Chưa có quy trình $process cho $tenant: make app-install APP=facilities-commune"
  exit 1
fi
period=$(flowable GET "/repository/process-definitions/$definition/resourcedata" |
  sed -n 's:.*<timeDuration>\(.*\)</timeDuration>.*:\1:p')
# Không đọc được thời hạn là lỗi, không phải SKIP: SKIP thì CI vẫn xanh mà không kiểm phần công khai.
if [[ -z "$period" ]]; then
  echo "FAIL  Không đọc được thời hạn công khai (timeDuration) trong quy trình $process đã deploy cho $tenant"
  exit 1
fi
# Chỉ thời hạn dạng PT<n>S ngắn hơn thời gian chờ mới chờ được; thời hạn theo văn bản (P30D) thì bỏ qua phần chờ.
short=false
if [[ "$period" =~ ^PT([0-9]+)S$ ]] && ((BASH_REMATCH[1] < wait_limit)); then short=true; fi

# Lần chạy trước dừng giữa lúc đổi và đặt lại dòng thì dòng của xã A còn ở vai trò khác.
restore_decider >/dev/null

# Bốn mắt: manager.a có vai trò duyệt nhưng là người lập thì không tự duyệt được. Phải là người có vai trò manager,
# vì người không có vai trò bị chặn ở bước kiểm vai trò trước khi tới quy tắc bốn mắt.
own=$(api "$manager" POST "/processes/$process/instances" \
  "{\"variables\": {\"title\": \"$title G\", \"excessM2\": 100}}" | sed '$d' | jq -r .id)
out=$(api "$manager" POST "/tasks/$(task_of "$own")/complete" '{"variables": {"approved": true}}')
check "Người lập là manager cũng không tự duyệt hồ sơ của mình (bốn mắt)" \
  "$(tail -1 <<<"$out") $(sed '$d' <<<"$out" | jq -r '.error // "" | startswith("Quy tắc bốn mắt")')" "403 true"
# Xã không còn manager nào khác để trả lại hồ sơ, và API quy trình không có lệnh hủy: xóa thẳng ở Flowable. Xóa hồ sơ
# là lần ghi duy nhất đi vòng qua cổng, chỉ trong bài kiểm; không xóa thì mỗi lần chạy, bảng việc của manager.a tích
# thêm một hồ sơ cho tới khi gỡ gói.
flowable DELETE "/runtime/process-instances/$own" >/dev/null

# Vượt 420 m², trên ngưỡng 300: bước duyệt để công khai. Hồ sơ A lập khi dòng của xã A là manager; quản trị tỉnh
# đổi dòng sang tenant_admin rồi lập hồ sơ A2, rồi đặt lại ngay về manager: vai trò ghi vào hồ sơ lúc lập, nên A vẫn
# ở manager, A2 vẫn ở tenant_admin dù dòng đã đổi lại.
above=$(file "{\"title\": \"$title A\", \"excessM2\": 420}")
check "Vượt 420 m² (trên ngưỡng): hồ sơ vào bước duyệt để công khai" "$(step_of "$above")" review_publish
check "Bảng phân cấp: hồ sơ lập theo dòng mặc định có bước quyết định ở manager" "$(decider_of "$above")" manager
# Vượt 1500 m², trên ngưỡng minh họa 1000 của dòng province: bước quyết định ở người duyệt của tỉnh, các bước trước
# vẫn ở xã.
province=$(file "{\"title\": \"$title P\", \"excessM2\": 1500}")
check "Bước của tỉnh: hồ sơ vượt 1500 m² có bước quyết định ở tinh-mau/manager" "$(decider_of "$province")" \
  tinh-mau/manager
check "Bước của tỉnh: manager.tinh không thấy bước duyệt để công khai của xã A" "[$(step_of "$province" \
  "$manager_tinh")]" "[]"
check "Bảng phân cấp: quản trị xã A không sửa được bảng của chính xã mình" "$(set_decider "$admin_a" tenant_admin)" 0
trap 'restore_decider >/dev/null || true' EXIT
check "Bảng phân cấp: quản trị tỉnh đổi dòng của xã A sang tenant_admin" \
  "$(set_decider "$(token admin.tinh)" tenant_admin)" 1
later=$(file "{\"title\": \"$title A2\", \"excessM2\": 420}")
check "Bảng phân cấp: quản trị tỉnh đặt lại dòng của xã A về manager" "$(restore_decider)" 1
trap - EXIT
check "Bảng phân cấp: hồ sơ lập sau khi đổi có bước quyết định ở tenant_admin, hồ sơ lập trước vẫn ở manager" \
  "$(decider_of "$later") $(decider_of "$above")" "tenant_admin manager"
if [[ $short == false ]]; then
  # Duyệt thì hồ sơ nằm chờ hết thời hạn thật; trả lại để hồ sơ kết thúc ngay.
  echo "SKIP  Thời hạn công khai đang deploy là '${period}', smoke chỉ chờ ${wait_limit} giây: bỏ qua phần công" \
    "khai, trình và quyết định. Kiểm cả phần này: make app-install APP=facilities-commune" \
    "SETTINGS=publication_period=PT20S"
  for instance in "$above" "$later" "$province"; do
    complete "$manager" "$instance" '{"approved": false}' >/dev/null
  done
else
  # Người duyệt gửi kèm excessM2 = 0: nhánh đã chọn lúc lập hồ sơ nên không đổi.
  check "Người duyệt duyệt hồ sơ" "$(complete "$manager" "$above" '{"approved": true, "excessM2": 0}')" 204
  for instance in "$later" "$province"; do complete "$manager" "$instance" '{"approved": true}' >/dev/null; done
  check "Đang công khai: chưa kết thúc, chưa có bước nào cho người dùng" "$(status "$above") [$(step_of "$above")]" \
    "false null []"
  # Hai hồ sơ công khai cùng lúc nên chỉ chờ một lần.
  waited=0
  while [[ -z "$(step_of "$above")" || -z "$(step_of "$later")" || -z "$(step_of "$province")" ]] &&
    ((waited < wait_limit)); do
    sleep 5
    waited=$((waited + 5))
  done
  if [[ -z "$(step_of "$above")" || -z "$(step_of "$later")" || -z "$(step_of "$province")" ]]; then
    echo "FAIL  Thời hạn công khai ${period} nhưng hết ${wait_limit} giây hồ sơ vẫn đang công khai"
    fail=1
  else
    check "Hết thời hạn công khai: hồ sơ sang bước trình người có thẩm quyền" \
      "$(step_of "$above") $(step_of "$later") $(step_of "$province")" "submit submit submit"
    check "Bước của tỉnh: manager.tinh không thấy bước trình của xã A" "[$(step_of "$province" "$manager_tinh")]" "[]"
    # Trường của bước (ADR 0031): decision là trường của bước quyết định, người trình không ghi sẵn được.
    check "Người trình không gửi được nội dung quyết định khi hoàn thành bước trình" \
      "$(complete "$manager" "$above" '{"recipient": "Đơn vị kiểm thử", "submitted": true, "decision": "Đặt sẵn"}')" 400
    for instance in "$above" "$later" "$province"; do
      complete "$manager" "$instance" '{"recipient": "Đơn vị kiểm thử", "submitted": true}' >/dev/null
    done
    check "Trình xong: hồ sơ A sang bước quyết định, manager.a thấy, admin.a không thấy" \
      "$(step_of "$above") [$(step_of "$above" "$admin_a")]" "decide []"
    check "Trình xong: hồ sơ A2 sang bước quyết định ở tenant_admin, admin.a thấy, manager.a không thấy" \
      "$(step_of "$later" "$admin_a") [$(step_of "$later")]" "decide []"
    decision='{"decision": "Quyết định kiểm thử", "decided": true}'
    out=$(api "$admin_a" POST "/tasks/$(task_of "$later" "$admin_a")/complete" "{\"variables\": $decision}")
    check "Bước quyết định cần OTP: admin.a (tenant_admin, đăng nhập bằng mật khẩu) bị từ chối" \
      "$(tail -1 <<<"$out") $(sed '$d' <<<"$out" | jq -r '.error // "" | test("OTP")')" "403 true"
    # Lớp chặn thật là kiểm vai trò khi hoàn thành, không phải bảng việc: manager.a gửi thẳng mã task (lấy qua
    # admin.a) vẫn bị từ chối.
    out=$(api "$manager" POST "/tasks/$(task_of "$later" "$admin_a")/complete" "{\"variables\": $decision}")
    check "Bước quyết định ở tenant_admin: manager.a (có OTP) hoàn thành bằng mã task bị từ chối vì sai vai trò" \
      "$(tail -1 <<<"$out") $(sed '$d' <<<"$out" | jq -r '.error // "" | startswith("Vai trò")')" "403 true"
    # admin2.a là tenant_admin của xã A có otp_required (scripts/seed.sh), nên đăng nhập phải kèm mã OTP.
    admin2_a=$(token admin2.a "$(uv run --quiet --no-project python scripts/otp.py next admin2.a)")
    check "Bước quyết định: admin2.a (tenant_admin, có OTP) ghi nhận quyết định hồ sơ A2" \
      "$(complete "$admin2_a" "$later" "$decision")" 204
    check "Bước quyết định: manager.a (có OTP) ghi nhận quyết định hồ sơ A" \
      "$(complete "$manager" "$above" "$decision")" 204
    check "Ghi nhận quyết định xong: hai hồ sơ kết thúc ở đã có quyết định" "$(status "$above") $(status "$later")" \
      "true decided true decided"
    delegated=$(task_of "$province" "$manager_tinh")
    check "Bước của tỉnh: trình xong, manager.tinh thấy bước quyết định, task ghi tenant xa-a" \
      "$(pending "$province" step "$manager_tinh") $(pending "$province" tenant "$manager_tinh")" "decide xa-a"
    check "Bước của tỉnh: manager.a, manager.b, manager.k không thấy bước quyết định đó" \
      "[$(step_of "$province")$(step_of "$province" "$manager_b")$(step_of "$province" "$manager_k")]" "[]"
    for pair in "manager.b $manager_b" "manager.k $manager_k" "manager.a $manager"; do
      read -r name stranger <<<"$pair"
      out=$(api "$stranger" POST "/tasks/$delegated/complete" "{\"variables\": $decision}" | tail -1)
      # manager.a ở chính xã của hồ sơ: thấy task tồn tại nên nhận 403 của luật vai trò, như mọi task trong xã.
      [[ $name == manager.a ]] && want=403 || want=404
      check "Bước của tỉnh: $name hoàn thành bước quyết định bằng mã task bị từ chối" "$out" "$want"
    done
    check "Bước của tỉnh: tỉnh không đọc được trạng thái hồ sơ của xã A" \
      "$(api "$manager_tinh" GET "/instances/$province" | tail -1)" 404
    check "Bước của tỉnh: manager.tinh (có OTP) ghi nhận quyết định" \
      "$(complete "$manager_tinh" "$province" "$decision")" 204
    check "Bước của tỉnh: hồ sơ của xã A kết thúc ở đã có quyết định" "$(status "$province")" "true decided"
  fi
fi
# Hồ sơ chưa kết thúc vì một bước ở trên hỏng (hết giờ chờ công khai, bị từ chối) thì xóa: hồ sơ đang công khai không
# trả lại được qua API, và để lại thì nó nằm trên bảng việc của xã A sau mỗi lần chạy hỏng.
for instance in "$above" "$later" "$province"; do
  [[ "$(status "$instance")" == true\ * ]] || flowable DELETE "/runtime/process-instances/$instance" >/dev/null
done

# Đúng bằng ngưỡng: không công khai, duyệt xong là báo cáo để tiếp tục sử dụng.
equal=$(file "{\"title\": \"$title B\", \"excessM2\": 300}")
check "Vượt đúng 300 m² (bằng ngưỡng): hồ sơ vào bước duyệt báo cáo" "$(step_of "$equal")" review_report
complete "$manager" "$equal" '{"approved": true}' >/dev/null
check "Duyệt xong: kết thúc ở báo cáo tiếp tục sử dụng, không công khai" "$(status "$equal")" "true retained"

# Vừa trên ngưỡng thì công khai; thiếu số liệu thì cũng công khai, không đi nhánh nhẹ hơn.
just=$(file "{\"title\": \"$title C\", \"excessM2\": 300.5}")
check "Vượt 300,5 m² (vừa trên ngưỡng): hồ sơ vào bước duyệt để công khai" "$(step_of "$just")" review_publish
missing=$(file "{\"title\": \"$title D\"}")
check "Thiếu phần vượt: hồ sơ đi nhánh công khai" "$(step_of "$missing")" review_publish
negative=$(file "{\"title\": \"$title E\", \"excessM2\": -5}")
check "Phần vượt âm: hồ sơ đi nhánh công khai" "$(step_of "$negative")" review_publish
# Không đọc được thành số: Flowable lỗi khi xét nhánh và không tạo hồ sơ, thay vì đi một nhánh nào đó.
check "Phần vượt không phải số: không lập được hồ sơ" \
  "$(api "$user" POST "/processes/$process/instances" '{"variables": {"title": "x", "excessM2": "abc"}}' | tail -1)" 502

# Người lập đặt sẵn approved = true: workflow-api từ chối vì cổng sau bước duyệt đọc biến này (ADR 0025).
check "Không lập được hồ sơ đặt sẵn quyết định của người duyệt" \
  "$(api "$user" POST "/processes/$process/instances" \
    "{\"variables\": {\"title\": \"$title F\", \"excessM2\": 100, \"approved\": true}}" | tail -1)" 400

# Nội dung quyết định là trường của bước quyết định (ADR 0031): người lập không gửi sẵn được, kể cả khi không cổng
# nào đọc nó.
check "Không lập được hồ sơ đặt sẵn nội dung quyết định của người có thẩm quyền" \
  "$(api "$user" POST "/processes/$process/instances" \
    "{\"variables\": {\"title\": \"$title H\", \"excessM2\": 100, \"decision\": \"Đặt sẵn\"}}" | tail -1)" 400

# Trả lại để các hồ sơ còn lại kết thúc.
for instance in "$just" "$missing" "$negative"; do
  complete "$manager" "$instance" '{"approved": false}' >/dev/null
done
check "Trả lại hồ sơ trên ngưỡng: kết thúc, không công khai" "$(status "$just")" "true rejected_publish"

exit $fail
