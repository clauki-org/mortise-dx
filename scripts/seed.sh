#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Nạp dữ liệu demo: 2 tenant, tài khoản Keycloak cho từng tenant, metadata Hasura
# (track bảng + quyền theo tenant). Chạy lại nhiều lần không lỗi.
set -euo pipefail
cd "$(dirname "$0")/.."
# .env do `make env` sinh ra và không có trong repo, nên shellcheck không đọc theo.
set -a
# shellcheck source=/dev/null
source .env
set +a

kc() { docker compose exec -T keycloak /opt/keycloak/bin/kcadm.sh "$@"; }

kc config credentials --server http://localhost:8080/auth --realm master \
  --user admin --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null 2>&1

# Mọi người dùng mới đều có vai trò `user` (Hasura cần vai trò này trong token).
# Keycloak bỏ qua defaultRole khi import realm nên gán ở đây.
kc add-roles -r dxos --rname default-roles-dxos --rolename user >/dev/null

# username  tenant   vai trò thêm
users=(
  "user.a  xuong-a  -"
  "manager.a  xuong-a  manager"
  "user.b  xuong-b  -"
)

for entry in "${users[@]}"; do
  read -r username tenant role <<<"$entry"
  if [[ -z "$(kc get users -r dxos -q "username=$username" -q exact=true --fields id --format csv --noquotes)" ]]; then
    kc create users -r dxos -s "username=$username" -s enabled=true \
      -s "email=$username@demo.invalid" -s emailVerified=true \
      -s "firstName=$username" -s "lastName=Demo" >/dev/null 2>&1
  fi
  kc set-password -r dxos --username "$username" --new-password "$DEMO_USER_PASSWORD" >/dev/null
  user_id=$(kc get users -r dxos -q "username=$username" -q exact=true --fields id --format csv --noquotes)
  group_id=$(kc get groups -r dxos -q "search=$tenant" --fields id,name --format csv --noquotes | awk -F, -v n="$tenant" '$2==n{print $1}')
  kc update "users/$user_id/groups/$group_id" -r dxos -s realm=dxos -s "userId=$user_id" -s "groupId=$group_id" -n >/dev/null
  if [[ "$role" != "-" ]]; then
    kc add-roles -r dxos --uusername "$username" --rolename "$role" >/dev/null
  fi
  echo "keycloak: $username, tenant $tenant, vai trò thêm: $role"
done

# Tenant demo là dữ liệu, không phải lược đồ, nên nằm ở seed chứ không nằm trong migration:
# bản cài thật không được tự có hai tenant demo. Tên trùng tên group trong realm.
docker compose exec -T postgres psql -qX -v ON_ERROR_STOP=1 --username hasura --dbname dxos <<'SQL'
INSERT INTO core.tenants (id, name) VALUES
    ('xuong-a', 'Tenant A (demo)'),
    ('xuong-b', 'Tenant B (demo)')
ON CONFLICT (id) DO NOTHING;
SQL
echo "postgres: tenant demo xuong-a, xuong-b"

hasura() {
  curl -fsS -X POST "http://127.0.0.1:${HASURA_PORT:-8082}/v1/metadata" \
    -H "X-Hasura-Admin-Secret: $HASURA_ADMIN_SECRET" -H 'Content-Type: application/json' -d "$1"
}

hasura '{"type":"bulk_keep_going","args":[
  {"type":"pg_track_table","args":{"source":"default","table":{"schema":"core","name":"tenants"}}},
  {"type":"pg_create_select_permission","args":{"source":"default","table":{"schema":"core","name":"tenants"},
    "role":"user","permission":{"columns":["id","name","created_at"],"filter":{"id":{"_eq":"X-Hasura-Tenant-Id"}}}}}
]}' >/dev/null
echo "hasura: metadata đã áp dụng"

# Deploy mọi quy trình lõi cho từng tenant có trong core.tenants. Flowable đặt tên
# deployment theo tên tệp tải lên (bỏ qua trường deploymentName), nên băm của tệp được
# gắn vào tên tệp: chạy lại seed không tạo phiên bản mới nếu tệp BPMN không đổi.
flowable="http://127.0.0.1:${FLOWABLE_PORT:-8083}/flowable-rest/service"
tenants=$(curl -fsS -X POST "http://127.0.0.1:${HASURA_PORT:-8082}/v1/graphql" \
  -H "X-Hasura-Admin-Secret: $HASURA_ADMIN_SECRET" -H 'Content-Type: application/json' \
  -d '{"query":"{ core_tenants { id } }"}' | jq -r '.data.core_tenants[].id')
for file in core/workflow/processes/*.bpmn20.xml; do
  name="$(basename "$file" .bpmn20.xml)-$(sha256sum "$file" | cut -c1-12)"
  for tenant in $tenants; do
    existing=$(curl -fsS -u "rest-admin:$FLOWABLE_ADMIN_PASSWORD" \
      "$flowable/repository/deployments?name=$name&tenantId=$tenant" | jq '.total')
    if [[ "$existing" == "0" ]]; then
      curl -fsS -u "rest-admin:$FLOWABLE_ADMIN_PASSWORD" -F "file=@$file;filename=$name.bpmn20.xml" \
        -F "tenantId=$tenant" "$flowable/repository/deployments" >/dev/null
      echo "flowable: deploy $name cho $tenant"
    fi
  done
done
echo "flowable: quy trình đã sẵn sàng"
