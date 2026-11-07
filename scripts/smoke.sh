#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm tra đầu-cuối qua cổng APISIX: zero-trust, SSO và cách ly tenant.
set -euo pipefail
cd "$(dirname "$0")/.."
# .env do `make env` sinh ra và không có trong repo, nên shellcheck không đọc theo.
set -a
# shellcheck source=/dev/null
source .env
set +a

base="${DXOS_PUBLIC_URL:-http://localhost:9080}"
query='{"query":"{ core_tenants { id } }"}'
fail=0

check() {
  if [[ "$2" == "$3" ]]; then echo "PASS  $1"; else echo "FAIL  $1 (muốn: $3, nhận: $2)"; fail=1; fi
}

token() {
  curl -fsS "$base/auth/realms/dxos/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=dxos-web \
    -d "username=$1" -d "password=$DEMO_USER_PASSWORD" | jq -r .access_token
}

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/v1/graphql" -H 'Content-Type: application/json' -d "$query")
check "API không token bị chặn tại cổng" "$status" 401

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/v1/graphql" \
  -H 'Authorization: Bearer invalid.token.value' -H 'Content-Type: application/json' -d "$query")
check "Token giả bị chặn tại cổng" "$status" 401

status=$(curl -s -o /dev/null -w '%{http_code}' "$base/auth/admin/")
check "Console quản trị Keycloak không lộ qua cổng" "$status" 403

for pair in "user.a xuong-a" "user.b xuong-b"; do
  read -r user tenant <<<"$pair"
  tenants=$(curl -fsS -X POST "$base/v1/graphql" -H "Authorization: Bearer $(token "$user")" \
    -H 'Content-Type: application/json' -d "$query" | jq -c '[.data.core_tenants[].id]')
  check "$user chỉ thấy dữ liệu tenant của mình" "$tenants" "[\"$tenant\"]"
done

exit $fail
