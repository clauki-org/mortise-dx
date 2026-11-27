#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Tạo .env từ .env.example, thay mọi giá trị `change-me` bằng bí mật ngẫu nhiên. Nếu
# .env đã có, chỉ thêm các biến mới xuất hiện trong .env.example và giữ nguyên biến cũ,
# để người đã dựng lõi trước đó không phải xóa .env sau mỗi lần lõi có thêm dịch vụ.
# Biến không phải bí mật lấy giá trị từ môi trường nếu có, để bản cài thứ hai trên cùng máy tạo .env với tên dự án,
# cổng, URL riêng trong một lệnh (ADR 0058): `COMPOSE_PROJECT_NAME=dmt MORTISE_PORT=9180 ... make env`. Bí mật
# (`change-me`) luôn sinh mới: lấy từ môi trường thì một biến tình cờ có trong shell sẽ thành mật khẩu của bản cài.
set -euo pipefail
cd "$(dirname "$0")/.."

# value_for TÊN GIÁ_TRỊ_MẪU
value_for() {
  if [[ "$2" == "change-me" ]]; then
    openssl rand -hex 16
  elif [[ -n "${!1+set}" ]]; then
    printf '%s' "${!1}"
  else
    printf '%s' "$2"
  fi
}

if [[ ! -f .env ]]; then
  while IFS= read -r line; do
    if [[ "$line" =~ ^([A-Z_]+)=(.*)$ ]]; then
      printf '%s=%s\n' "${BASH_REMATCH[1]}" "$(value_for "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}")"
    else
      printf '%s\n' "$line"
    fi
  done < .env.example > .env
  chmod 600 .env
  echo "Đã tạo .env"
  exit 0
fi

added=0
while IFS= read -r line; do
  if [[ "$line" =~ ^([A-Z_]+)=(.*)$ ]] && ! grep -q "^${BASH_REMATCH[1]}=" .env; then
    printf '%s=%s\n' "${BASH_REMATCH[1]}" "$(value_for "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}")" >> .env
    echo "Đã thêm ${BASH_REMATCH[1]} vào .env"
    added=1
  fi
done < .env.example
[[ $added == 1 ]] || echo ".env đã đủ biến, giữ nguyên."
