#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Đặt chính sách đăng nhập của một tenant trên Keycloak đang chạy (ADR 0040). Tenant là group cấp cao nhất của realm
# `mortise`; luồng đăng nhập hỏi OTP người có vai trò `otp_required` của client `mortise-web`, kể cả vai trò nhận qua
# group (ADR 0011). Vì vậy gán vai trò đó cho group của tenant là bắt mọi tài khoản của tenant nhập OTP, không phải đổi
# luồng đăng nhập.
#   otp       mọi tài khoản của tenant phải nhập mã OTP
#   default   bỏ yêu cầu chung của tenant; manager và tài khoản được gán otp_required riêng vẫn phải nhập OTP
# Chạy lại với cùng chính sách thì không đổi gì. `make seed` gọi lệnh này cho tenant demo.
set -euo pipefail
cd "$(dirname "$0")/.."
# .env do `make env` sinh ra và không có trong repo, nên shellcheck không đọc theo.
set -a
# shellcheck source=/dev/null
source .env
set +a

slug='^[a-z0-9]+(-[a-z0-9]+)*$'
tenant="${1:-}" policy="${2:-}"
if [[ ! "$tenant" =~ $slug || ! "$policy" =~ ^(otp|default)$ ]]; then
  echo "Cách dùng: make tenant-login TENANT=<tenant> POLICY=otp|default" >&2
  exit 1
fi

kc() { docker compose exec -T keycloak /opt/keycloak/bin/kcadm.sh "$@" </dev/null; }

if ! kc config credentials --server http://localhost:8080/auth --realm master \
  --user admin --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null 2>&1; then
  echo "Không đăng nhập được API quản trị Keycloak. Lõi đã chạy chưa (make up)?" >&2
  exit 1
fi

# `search` của Keycloak khớp một phần tên, nên lọc đúng tên ở đây: gõ `xa` không được trúng `xa-a`.
group_id=$(kc get groups -r mortise -q "search=$tenant" --fields id,name --format csv --noquotes |
  awk -F, -v n="$tenant" '$2==n{print $1}')
if [[ -z "$group_id" ]]; then
  echo "Tenant '$tenant' không có trong Keycloak (không có group cấp cao nhất tên này)." >&2
  exit 1
fi
web_client=$(kc get clients -r mortise -q clientId=mortise-web --fields id --format csv --noquotes)
if [[ -z "$web_client" ]] || ! kc get "clients/$web_client/roles/otp_required" -r mortise >/dev/null 2>&1; then
  echo "Realm chưa có vai trò otp_required của client mortise-web; chạy make seed trước." >&2
  exit 1
fi

# Đọc vai trò đang gán thẳng cho group, để chỉ gọi API khi phải đổi và in đúng trạng thái. kcadm in một dòng trống ra
# stderr với lệnh này; lỗi thật vẫn dừng script nhờ pipefail.
current=$(kc get "groups/$group_id/role-mappings/clients/$web_client" -r mortise 2>/dev/null |
  jq -r 'if any(.[]; .name == "otp_required") then "otp" else "default" end')
if [[ "$current" == "$policy" ]]; then
  echo "keycloak: tenant $tenant đã ở chính sách đăng nhập $policy"
  exit 0
fi
if [[ "$policy" == otp ]]; then
  kc add-roles -r mortise --gid "$group_id" --cclientid mortise-web --rolename otp_required >/dev/null
  echo "keycloak: tenant $tenant bắt buộc OTP với mọi tài khoản, áp dụng từ lần đăng nhập sau"
else
  kc remove-roles -r mortise --gid "$group_id" --cclientid mortise-web --rolename otp_required >/dev/null
  echo "keycloak: tenant $tenant về chính sách mặc định; manager và tài khoản có otp_required riêng vẫn nhập OTP"
fi
