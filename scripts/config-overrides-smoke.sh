#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Quyền của lớp ghi đè cấu hình qua cổng (ADR 0060), gọi từ scripts/smoke.sh: quản trị tỉnh (tenant gốc) ghi và xóa
# phần chỉnh, quản trị xã A (tenant con) thì không; cán bộ xã A đọc được phần chỉnh của tỉnh, tỉnh khác không đọc được;
# đích không có trong cấu hình gốc bị CSDL từ chối. Dùng mục mẫu của lõi (core/ask-example, `make seed` nạp) với giá
# trị hidden = false, nên phần chỉnh còn sót khi bài dừng giữa chừng cũng không đổi gì trên menu; vẫn xóa khi thoát.
#
# SC2016: biến GraphQL ($v) nằm trong nháy đơn để shell không mở rộng; giá trị đi qua trường variables.
# shellcheck disable=SC2016
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
# shellcheck source=/dev/null
source .env
set +a

base="${MORTISE_PUBLIC_URL:-http://localhost:9080}"
fail=0

check() {
  if [[ "$2" == "$3" ]]; then echo "PASS  $1"; else echo "FAIL  $1 (muốn: $3, nhận: $2)"; fail=1; fi
}
token() {
  curl -fsS "$base/auth/realms/mortise/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=mortise-test \
    -d "username=$1" -d "password=$DEMO_USER_PASSWORD" ${2:+-d "totp=$2"} | jq -r .access_token
}
gql() {
  jq -cn --arg q "$2" --argjson v "${3:-{\}}" '{query: $q, variables: $v}' |
    curl -fsS -X POST "$base/v1/graphql" -H "Authorization: Bearer $1" -H "X-Hasura-Role: ${4:-user}" \
      -H 'Content-Type: application/json' -d @-
}
sql() { docker compose exec -T postgres psql -qAtX -v ON_ERROR_STOP=1 -U postgres -d mortise "$@"; }

cleanup() {
  sql -c "DELETE FROM platform.config_overrides WHERE app = 'core' AND item = 'ask-example' AND kind = 'hidden'" \
    >/dev/null
}
cleanup
trap cleanup EXIT

admin_tinh=$(token admin.tinh)
admin_a=$(token admin.a)
user_a=$(token user.a)
manager_k=$(token manager.k "$(uv run --quiet --no-project python scripts/otp.py next manager.k)")

put='mutation($v: jsonb!, $t: String!) { insert_platform_config_overrides_one(object: {app: "core",
  item: "ask-example", kind: "hidden", target: $t, value: $v},
  on_conflict: {constraint: config_overrides_pkey, update_columns: [value]}) { root_tenant_id } }'
check "Quản trị xã A (tenant con) không ghi được phần chỉnh" \
  "$(gql "$admin_a" "$put" '{"v": false, "t": ""}' tenant_admin | jq 'has("errors")')" true
check "Quản trị tỉnh ghi phần chỉnh, tenant gốc lấy từ token" \
  "$(gql "$admin_tinh" "$put" '{"v": false, "t": ""}' tenant_admin |
    jq -r '.data.insert_platform_config_overrides_one.root_tenant_id')" tinh-mau
check "Ghi lại cùng đích thì sửa giá trị (on_conflict)" \
  "$(gql "$admin_tinh" "$put" '{"v": false, "t": ""}' tenant_admin |
    jq -r '.data.insert_platform_config_overrides_one.root_tenant_id')" tinh-mau
check "Đích không có trong cấu hình gốc bị CSDL từ chối" \
  "$(gql "$admin_tinh" "$put" '{"v": false, "t": "khong-co"}' tenant_admin |
    jq -r '.errors[0].message // "nhận" | test("không phải trường")')" true

seen='query { platform_config_overrides_by_tenant(where: {app: {_eq: "core"}, item: {_eq: "ask-example"},
  kind: {_eq: "hidden"}}) { tenant_id } }'
check "Cán bộ xã A đọc được phần chỉnh của tỉnh" \
  "$(gql "$user_a" "$seen" | jq -c '[.data.platform_config_overrides_by_tenant[].tenant_id]')" '["xa-a"]'
check "Tỉnh khác không đọc được phần chỉnh của Tỉnh Mẫu" \
  "$(gql "$manager_k" "$seen" | jq '.data.platform_config_overrides_by_tenant | length')" 0

reset='mutation { delete_platform_config_overrides(where: {app: {_eq: "core"}, item: {_eq: "ask-example"},
  kind: {_eq: "hidden"}}) { affected_rows } }'
check "Quản trị xã A không xóa được phần chỉnh của tỉnh" \
  "$(gql "$admin_a" "$reset" '{}' tenant_admin | jq '.data.delete_platform_config_overrides.affected_rows')" 0
check "Về mặc định: quản trị tỉnh xóa phần chỉnh của mục" \
  "$(gql "$admin_tinh" "$reset" '{}' tenant_admin | jq '.data.delete_platform_config_overrides.affected_rows')" 1
check "Nhật ký ghi lần xóa với tenant gốc" "$(sql -c "SELECT count(*) > 0 FROM core.audit_log
  WHERE table_name = 'platform.config_overrides' AND op = 'DELETE' AND tenant_id = 'tinh-mau'
    AND before ->> 'item' = 'ask-example'")" t

exit $fail
