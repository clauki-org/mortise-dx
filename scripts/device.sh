#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Cấp và thu hồi tài khoản MQTT của thiết bị trên Mosquitto đang chạy (ADR 0012). Tài khoản là
# `<tenant>.<thiết bị>`, chỉ được gửi vào chủ đề `mortise/<tenant>/<thiết bị>`; cầu nối lấy tenant từ chủ
# đề, nên thiết bị không gửi được số đo cho đơn vị khác. Mosquitto đọc lại tệp tài khoản khi nhận SIGHUP,
# không cần khởi động lại.
#   add <tenant> <thiết bị> [mật khẩu]   cấp hoặc đặt lại mật khẩu; không truyền thì sinh ngẫu nhiên và in ra
#   remove <tenant> <thiết bị>           thu hồi
#
# SC2016: lệnh chạy trong container nằm trong nháy đơn và nhận giá trị qua tham số vị trí ($1, $2…), không ghép
# chuỗi, để tên thiết bị hay mật khẩu không bao giờ bị shell trong container hiểu thành lệnh.
# shellcheck disable=SC2016
set -euo pipefail
cd "$(dirname "$0")/.."

slug='^[a-z0-9]+(-[a-z0-9]+)*$'
action="${1:-}" tenant="${2:-}" device="${3:-}"
if [[ ! "$action" =~ ^(add|remove)$ || ! "$tenant" =~ $slug || ! "$device" =~ $slug || ${#device} -gt 64 ]]; then
  echo "Cách dùng: make device-add|device-remove TENANT=<tenant> DEVICE=<thiết bị> (chữ thường, số, gạch nối)" >&2
  exit 1
fi
user="$tenant.$device"
auth=/mosquitto/auth
# </dev/null: không đọc stdin của người gọi, nếu không vòng lặp `while read` của make seed dừng sau thiết bị đầu.
in_broker() { docker compose exec -T mosquitto sh -c "$1" sh "${@:2}" </dev/null; }

if [[ "$action" == add ]]; then
  # Tenant gõ sai thì Scorpio sẽ tạo một CSDL cho tên đó ở lần ghi đầu; chặn ngay khi cấp tài khoản.
  exists=$(docker compose exec -T postgres psql -qAtX -U postgres -d mortise -v t="$tenant" \
    <<<"SELECT count(*) FROM core.tenants WHERE id = :'t'")
  if [[ "$exists" != 1 ]]; then
    echo "Tenant '$tenant' không có trong core.tenants." >&2
    exit 1
  fi
  password="${4:-$(openssl rand -hex 16)}"
  in_broker 'mosquitto_passwd -b "$1/passwd" "$2" "$3" 2>/dev/null' "$auth" "$user" "$password"
  in_broker 'grep -qx "user $2" "$1/acl" || printf "user %s\ntopic write %s\n\n" "$2" "$3" >>"$1/acl"' \
    "$auth" "$user" "mortise/$tenant/$device"
else
  if ! in_broker 'grep -qx "user $2" "$1/acl"' "$auth" "$user"; then
    echo "Không có tài khoản $user." >&2
    exit 1
  fi
  in_broker 'mosquitto_passwd -D "$1/passwd" "$2" 2>/dev/null; sed -i "/^user $3\$/,/^\$/d" "$1/acl"' \
    "$auth" "$user" "${user//./\\.}"
fi
in_broker 'chown mosquitto:mosquitto "$1/passwd" "$1/acl" && chmod 0600 "$1/passwd" "$1/acl" && kill -HUP 1' "$auth"

if [[ "$action" == add ]]; then
  echo "Thiết bị $device của $tenant: tài khoản $user, gửi vào mortise/$tenant/$device"
  [[ -n "${4:-}" ]] || echo "Mật khẩu (chỉ in một lần): $password"
else
  echo "Đã thu hồi tài khoản $user"
fi
