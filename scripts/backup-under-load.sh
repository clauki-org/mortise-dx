#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Sao lưu trong khi người dùng vẫn tải tệp lên liên tục qua cổng, để kiểm bản sao lưu nhất quán giữa core.files và
# kho tệp: khôi phục bản này rồi scripts/files-verify.sh (restore.sh tự gọi) không được thấy đối tượng mồ côi hay dòng
# thiếu nội dung. CI chạy lệnh này thay cho `make backup` ở vòng sao lưu, khôi phục. Cần `make seed` (tài khoản demo).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
# shellcheck source=/dev/null
source .env
set +a
base="${MORTISE_PUBLIC_URL:-http://localhost:9080}"
log=$(mktemp)

# Mỗi vòng lấy token mới rồi tải một tệp nhỏ. Trong lúc sao lưu, cổng và Keycloak dừng nên các lần gọi lỗi; vòng lặp
# ghi lại mã HTTP (000 khi không kết nối được) rồi thử tiếp, không dừng.
upload_loop() {
  local token code
  while true; do
    token=$(curl -s "$base/auth/realms/mortise/protocol/openid-connect/token" -d grant_type=password \
      -d client_id=mortise-test -d username=user.a -d "password=$DEMO_USER_PASSWORD" | jq -r '.access_token // empty' \
      2>/dev/null || true)
    if [[ -z "$token" ]]; then
      echo token >>"$log"
      sleep 0.2
      continue
    fi
    code=$(head -c 2048 /dev/urandom | curl -s -o /dev/null -w '%{http_code}' -X POST \
      -H "Authorization: Bearer $token" -H 'Content-Type: application/pdf' --data-binary @- \
      "$base/v1/files?name=backup-under-load.pdf" || true)
    echo "$code" >>"$log"
  done
}

upload_loop &
loop=$!
trap 'kill "$loop" 2>/dev/null || true; rm -f "$log"' EXIT
# Chờ có lần tải lên thành công trước khi sao lưu, để vòng lặp chắc chắn đang ghi lúc dịch vụ bị dừng.
for _ in $(seq 60); do
  if grep -qx 201 "$log"; then break; fi
  sleep 0.5
done
before=$(grep -cx 201 "$log" || true)
scripts/backup.sh
# Vòng lặp phải tải được tiếp sau khi dịch vụ bật lại: sao lưu không để lõi ở trạng thái dừng.
for _ in $(seq 60); do
  if [[ $(grep -cx 201 "$log" || true) -gt $before ]]; then break; fi
  sleep 0.5
done
after=$(grep -cx 201 "$log" || true)
failed=$(grep -cvx 201 "$log" || true)
echo "Tải tệp trong lúc sao lưu: $before lần thành công trước, $((after - before)) lần sau khi bật lại, $failed lần bị từ chối hay không kết nối được"
if [[ $before -eq 0 || $after -le $before ]]; then
  echo "Không tải được tệp trước hoặc sau khi sao lưu: lõi chưa chạy, chưa seed, hay dịch vụ không bật lại." >&2
  exit 1
fi
