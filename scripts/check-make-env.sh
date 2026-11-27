#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm scripts/make-env.sh trên bản sao trong thư mục tạm, không đụng .env thật (gọi từ make check-fast, ADR 0058):
# mọi biến không phải bí mật của .env.example nhận giá trị đặt ở môi trường, mọi bí mật được sinh mới dù môi trường có
# giá trị. Bản cài thứ hai trên cùng máy tạo .env bằng cách này; một biến bị bỏ qua là hai bản cài tranh nhau một cổng.
set -euo pipefail
cd "$(dirname "$0")/.."

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/scripts"
cp scripts/make-env.sh "$work/scripts/"
cp .env.example "$work/"

overrides=()
while IFS='=' read -r key value; do
  overrides+=("$key=from-env-$key")
done < <(grep -E '^[A-Z][A-Z0-9_]*=' .env.example)
env "${overrides[@]}" "$work/scripts/make-env.sh" >/dev/null

fail=0
while IFS='=' read -r key value; do
  got=$(sed -n "s/^$key=//p" "$work/.env")
  if [[ "$value" == change-me ]]; then
    [[ "$got" =~ ^[0-9a-f]{32}$ ]] || { echo "make-env: bí mật $key không được sinh mới ('$got')" >&2; fail=1; }
  elif [[ "$got" != "from-env-$key" ]]; then
    echo "make-env: $key không nhận giá trị từ môi trường ('$got')" >&2
    fail=1
  fi
done < <(grep -E '^[A-Z][A-Z0-9_]*=' .env.example)
exit $fail
