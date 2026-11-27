#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Quyền bật, tắt gói qua cổng (ADR 0065), gọi từ scripts/smoke.sh: quản trị tỉnh (tenant gốc) thấy danh sách gói và
# tắt, bật được; quản trị xã A (tenant con) không thấy, không ghi được; tắt thì cán bộ xã A không còn đọc được mục menu
# của gói mà dòng vẫn còn, bật lại thì đọc được; có nhật ký. Dùng một gói thử chỉ có trong platform.apps và một mục
# menu thử của xã A với vai trò không ai có, nên giao diện không hiện nó kể cả khi bài dừng giữa chừng; vẫn xóa khi
# thoát.
#
# SC2016: biến GraphQL ($e) nằm trong nháy đơn để shell không mở rộng; giá trị đi qua trường variables.
# shellcheck disable=SC2016
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
# shellcheck source=/dev/null
source .env
set +a

base="${MORTISE_PUBLIC_URL:-http://localhost:9080}"
fail=0
app=smoke-app-states

check() {
  if [[ "$2" == "$3" ]]; then echo "PASS  $1"; else echo "FAIL  $1 (muốn: $3, nhận: $2)"; fail=1; fi
}
token() {
  curl -fsS "$base/auth/realms/mortise/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=mortise-test \
    -d "username=$1" -d "password=$DEMO_USER_PASSWORD" | jq -r .access_token
}
gql() {
  jq -cn --arg q "$2" --argjson v "${3:-{\}}" '{query: $q, variables: $v}' |
    curl -fsS -X POST "$base/v1/graphql" -H "Authorization: Bearer $1" -H "X-Hasura-Role: ${4:-user}" \
      -H 'Content-Type: application/json' -d @-
}
sql() { docker compose exec -T postgres psql -qAtX -v ON_ERROR_STOP=1 -U postgres -d mortise "$@"; }

# Xóa dòng platform.apps thì trạng thái đi theo (ON DELETE CASCADE).
cleanup() {
  sql -c "DELETE FROM platform.menu_items WHERE app = '$app'; DELETE FROM platform.apps WHERE app = '$app'" >/dev/null
}
cleanup
trap cleanup EXIT
sql -c "INSERT INTO platform.apps (app, name) VALUES ('$app', 'Gói thử bật tắt');
  INSERT INTO platform.menu_items (tenant_id, app, item, position, label, component, config, roles)
  VALUES ('xa-a', '$app', 'list', 0, 'Mục thử', 'catalog', '{}', '{smoke-nobody}')" >/dev/null

admin_tinh=$(token admin.tinh)
admin_a=$(token admin.a)
user_a=$(token user.a)

list='query { platform_apps_by_tenant(where: {app: {_eq: "smoke-app-states"}}) { enabled } }'
check "Quản trị tỉnh thấy gói đã cài, đang bật" \
  "$(gql "$admin_tinh" "$list" '{}' tenant_admin | jq -c '[.data.platform_apps_by_tenant[].enabled]')" '[true]'
check "Quản trị xã A (tenant con) không thấy danh sách gói" \
  "$(gql "$admin_a" "$list" '{}' tenant_admin | jq '.data.platform_apps_by_tenant | length')" 0

put='mutation($e: Boolean!) { insert_platform_app_states_one(object: {app: "smoke-app-states", enabled: $e},
  on_conflict: {constraint: app_states_pkey, update_columns: [enabled]}) { root_tenant_id enabled } }'
menu='query { platform_menu_items(where: {app: {_eq: "smoke-app-states"}}) { item } }'
check "Quản trị xã A không tắt được gói" "$(gql "$admin_a" "$put" '{"e": false}' tenant_admin | jq 'has("errors")')" true
check "Trước khi tắt, cán bộ xã A đọc được mục menu của gói" \
  "$(gql "$user_a" "$menu" | jq '.data.platform_menu_items | length')" 1
check "Quản trị tỉnh tắt gói, tenant gốc lấy từ token" \
  "$(gql "$admin_tinh" "$put" '{"e": false}' tenant_admin |
    jq -r '.data.insert_platform_app_states_one.root_tenant_id')" tinh-mau
check "Gói tắt: cán bộ xã A không đọc được mục menu, dòng vẫn còn" \
  "$(gql "$user_a" "$menu" | jq '.data.platform_menu_items | length') $(sql -c \
    "SELECT count(*) FROM platform.menu_items WHERE app = '$app'")" "0 1"
check "Bật lại (on_conflict): cán bộ xã A đọc lại được mục menu" \
  "$(gql "$admin_tinh" "$put" '{"e": true}' tenant_admin >/dev/null
    gql "$user_a" "$menu" | jq '.data.platform_menu_items | length')" 1
check "Nhật ký ghi lần tắt với tenant gốc" "$(sql -c "SELECT count(*) > 0 FROM core.audit_log
  WHERE table_name = 'platform.app_states' AND tenant_id = 'tinh-mau' AND after ->> 'app' = '$app'
    AND after ->> 'enabled' = 'false'")" t

exit $fail
