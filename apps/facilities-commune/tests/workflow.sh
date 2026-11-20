#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm quy trình rà soát của gói (bpmn/facilities-review.bpmn20.xml) qua cổng, bằng API quy trình như giao
# diện: phần vượt trên ngưỡng thì sau khi duyệt chờ hết thời hạn công khai rồi mới sang bước trình, từ ngưỡng trở
# xuống thì duyệt xong là kết thúc; người lập không tự duyệt; biến gửi kèm khi lập hay khi duyệt không đổi được
# nhánh. Ngưỡng và thời hạn đọc từ settings của app.yaml (ADR 0019): gói phải được cài với thời hạn ngắn, ví dụ
# make app-install APP=facilities-commune SETTINGS=publication_period=PT20S. Mọi hồ sơ tạo ra đều được đưa tới
# kết thúc. smoke.sh của gói gọi tệp này; cần lõi đang chạy, đã `make seed` và đã cài gói.
set -euo pipefail
cd "$(dirname "$0")/../../.."
# .env do `make env` sinh ra và không có trong repo, nên shellcheck không đọc theo.
set -a
# shellcheck source=/dev/null
source .env
set +a

base="${MORTISE_PUBLIC_URL:-http://localhost:9080}"
process=facilities-review
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

# step_of INSTANCE: bước đang chờ người duyệt của hồ sơ (rỗng nếu không có bước nào).
step_of() {
  api "$manager" GET /tasks | sed '$d' | jq -r --arg i "$1" '[.[] | select(.processInstanceId == $i) | .step] | join(",")'
}

task_of() {
  api "$manager" GET /tasks | sed '$d' | jq -r --arg i "$1" '[.[] | select(.processInstanceId == $i) | .id][0] // ""'
}

# complete TOKEN INSTANCE VARIABLES_JSON: hoàn thành bước đang chờ của hồ sơ, in mã HTTP.
complete() {
  api "$1" POST "/tasks/$(task_of "$2")/complete" "{\"variables\": $3}" | tail -1
}

status() { api "$manager" GET "/instances/$1" | sed '$d' | jq -r '"\(.ended) \(.outcome)"'; }

user=$(token user.a)
# Người duyệt phải gửi kèm mã OTP (ADR 0011); một token dùng cho cả bài để không tốn mã.
manager=$(token manager.a "$(uv run --quiet --no-project python scripts/otp.py next manager.a)")
title="Rà soát kiểm thử $(date +%s)"

# Vượt 420 m², trên ngưỡng 300: bước duyệt để công khai.
above=$(file "{\"title\": \"$title A\", \"excessM2\": 420}")
check "Vượt 420 m² (trên ngưỡng): hồ sơ vào bước duyệt để công khai" "$(step_of "$above")" review_publish
check "Người lập không tự duyệt hồ sơ của mình (bốn mắt)" "$(complete "$user" "$above" '{"approved": true}')" 403
# Người duyệt gửi kèm excessM2 = 0: nhánh đã chọn lúc lập hồ sơ nên không đổi.
check "Người duyệt duyệt hồ sơ" "$(complete "$manager" "$above" '{"approved": true, "excessM2": 0}')" 204
check "Đang công khai: chưa kết thúc, chưa có bước nào cho người dùng" "$(status "$above") [$(step_of "$above")]" \
  "false null []"
waited=0
while [[ -z "$(step_of "$above")" && $waited -lt $wait_limit ]]; do sleep 5; waited=$((waited + 5)); done
if [[ -z "$(step_of "$above")" ]]; then
  echo "FAIL  Hết ${wait_limit} giây vẫn đang công khai: gói có thể được cài với thời hạn thật (P30D). Cài lại:" \
    "make app-install APP=facilities-commune SETTINGS=publication_period=PT20S"
  fail=1
else
  check "Hết thời hạn công khai: hồ sơ sang bước trình người có thẩm quyền" "$(step_of "$above")" submit
  complete "$manager" "$above" '{"recipient": "Đơn vị kiểm thử", "submitted": true}' >/dev/null
  check "Trình xong: hồ sơ kết thúc ở bước đã trình" "$(status "$above")" "true submitted"
fi

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

# Người lập đặt sẵn approved = true: bước duyệt xóa biến này khi bắt đầu, nên hoàn thành mà không chọn là trả lại.
preset=$(file "{\"title\": \"$title F\", \"excessM2\": 100, \"approved\": true}")
complete "$manager" "$preset" '{}' >/dev/null
check "approved đặt sẵn lúc lập không thay được quyết định của người duyệt" "$(status "$preset")" "true rejected_report"

# Trả lại để các hồ sơ còn lại kết thúc.
for instance in "$just" "$missing" "$negative"; do
  complete "$manager" "$instance" '{"approved": false}' >/dev/null
done
check "Trả lại hồ sơ trên ngưỡng: kết thúc, không công khai" "$(status "$just")" "true rejected_publish"

exit $fail
