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
kc add-roles -r mortise --rname default-roles-mortise --rolename user >/dev/null

# Client chỉ dùng cho smoke và CI: còn bật password grant để lấy token bằng lệnh, không có redirect URI nên không
# dùng được cho đăng nhập qua trình duyệt. Tạo ở seed chứ không nằm trong tệp realm, để bản cài thật không có client
# nào nhận mật khẩu trực tiếp (ADR 0006). Mapper chép từ client giao diện để token mang cùng claim `tenant` và `amr`
# (ADR 0011); tạo lại mỗi lần seed để luôn khớp khi mapper của client giao diện đổi.
test_client=$(kc get clients -r mortise -q clientId=mortise-test --fields id --format csv --noquotes)
[[ -z "$test_client" ]] || kc delete "clients/$test_client" -r mortise
kc get clients -r mortise -q clientId=mortise-web | jq '.[0] | {
    clientId: "mortise-test", name: "Mortise DX smoke and CI", enabled: true, publicClient: true,
    standardFlowEnabled: false, implicitFlowEnabled: false, directAccessGrantsEnabled: true,
    redirectUris: [], webOrigins: [], protocolMappers: (.protocolMappers | map(del(.id)))
  }' | kc create clients -r mortise -f - -i >/dev/null
echo "keycloak: client kiểm thử mortise-test"

# Máy chủ phát triển giao diện (Vite) chạy ở địa chỉ khác URL công khai, nên client giao diện nhận thêm địa chỉ đó làm
# redirect URI, địa chỉ sau đăng xuất và web origin. Chỉ làm khi bản cài chạy trên máy cục bộ (URL công khai là
# localhost), để seed chạy nhầm trên máy chủ thật không mở thêm địa chỉ đăng nhập; realm trong tệp không đổi.
public_url="${MORTISE_PUBLIC_URL:-http://localhost:9080}"
if [[ "$public_url" =~ ^http://(localhost|127\.0\.0\.1)(:|/|$) ]]; then
  web_dev_url="${WEB_DEV_URL:-http://localhost:5173}"
  web_client=$(kc get clients -r mortise -q clientId=mortise-web --fields id --format csv --noquotes)
  kc get "clients/$web_client" -r mortise | jq --arg u "$web_dev_url" \
    '{redirectUris: ((.redirectUris + [$u + "/*"]) | unique), webOrigins: ((.webOrigins + [$u]) | unique),
      attributes: (.attributes + {"post.logout.redirect.uris": (((.attributes["post.logout.redirect.uris"] // "")
        | split("##") | map(select(. != ""))) + [$u + "/*"] | unique | join("##"))})}' |
    kc update "clients/$web_client" -r mortise -f - >/dev/null
  echo "keycloak: mortise-web nhận thêm $web_dev_url cho máy chủ phát triển giao diện"
fi

# username  tenant   vai trò thêm
users=(
  "user.a  xuong-a  -"
  "manager.a  xuong-a  manager"
  "user.b  xuong-b  -"
  "manager.b  xuong-b  manager"
)

for entry in "${users[@]}"; do
  read -r username tenant role <<<"$entry"
  if [[ -z "$(kc get users -r mortise -q "username=$username" -q exact=true --fields id --format csv --noquotes)" ]]; then
    kc create users -r mortise -s "username=$username" -s enabled=true \
      -s "email=$username@demo.invalid" -s emailVerified=true \
      -s "firstName=$username" -s "lastName=Demo" >/dev/null 2>&1
  fi
  kc set-password -r mortise --username "$username" --new-password "$DEMO_USER_PASSWORD" >/dev/null
  user_id=$(kc get users -r mortise -q "username=$username" -q exact=true --fields id --format csv --noquotes)
  group_id=$(kc get groups -r mortise -q "search=$tenant" --fields id,name --format csv --noquotes | awk -F, -v n="$tenant" '$2==n{print $1}')
  kc update "users/$user_id/groups/$group_id" -r mortise -s realm=mortise -s "userId=$user_id" -s "groupId=$group_id" -n >/dev/null
  if [[ "$role" != "-" ]]; then
    kc add-roles -r mortise --uusername "$username" --rolename "$role" >/dev/null
  fi
  # Người duyệt phải nhập mã OTP khi đăng nhập (ADR 0011). Gắn sẵn khóa từ .env để demo và kiểm thử không phải quét mã
  # QR; xóa khóa cũ trước để chạy lại seed không tích nhiều khóa. Người dùng thật tự cài khi đăng nhập lần đầu.
  if [[ "$role" == manager ]]; then
    : "${DEMO_OTP_SECRET:?Thiếu DEMO_OTP_SECRET trong .env; chạy make env}"
    kc get "users/$user_id/credentials" -r mortise | jq -r '.[] | select(.type == "otp") | .id' |
      while read -r credential; do kc delete "users/$user_id/credentials/$credential" -r mortise; done
    jq -n --arg secret "$DEMO_OTP_SECRET" '{credentials: [{
        type: "otp", userLabel: "demo",
        secretData: ({value: $secret} | tojson),
        credentialData: ({subType: "totp", digits: 6, period: 30, counter: 0, algorithm: "HmacSHA1"} | tojson)
      }]}' | kc update "users/$user_id" -r mortise -f - >/dev/null
  fi
  echo "keycloak: $username, tenant $tenant, vai trò thêm: $role"
done

# Tenant demo là dữ liệu, không phải lược đồ, nên nằm ở seed chứ không nằm trong migration:
# bản cài thật không được tự có hai tenant demo. Tên trùng tên group trong realm.
docker compose exec -T postgres psql -qX -v ON_ERROR_STOP=1 --username hasura --dbname mortise <<'SQL'
INSERT INTO core.tenants (id, name) VALUES
    ('xuong-a', 'Tenant A (demo)'),
    ('xuong-b', 'Tenant B (demo)')
ON CONFLICT (id) DO NOTHING;
SQL
echo "postgres: tenant demo xuong-a, xuong-b"

# Quyền dữ liệu của Hasura: áp tệp khai báo theo kiểu ghi đè, nên chạy lại seed cũng sửa được quyền đã bị đổi sai.
uv run --quiet --no-project --with pyyaml==6.0.3 python scripts/hasura-metadata.py apply

# Deploy quy trình mẫu dùng để kiểm thử lõi cho từng tenant có trong core.tenants. Flowable đặt tên
# deployment theo tên tệp tải lên (bỏ qua trường deploymentName), nên băm của tệp được
# gắn vào tên tệp: chạy lại seed không tạo phiên bản mới nếu tệp BPMN không đổi.
flowable="http://127.0.0.1:${FLOWABLE_PORT:-8083}/flowable-rest/service"
tenants=$(curl -fsS -X POST "http://127.0.0.1:${HASURA_PORT:-8082}/v1/graphql" \
  -H "X-Hasura-Admin-Secret: $HASURA_ADMIN_SECRET" -H 'Content-Type: application/json' \
  -d '{"query":"{ core_tenants { id } }"}' | jq -r '.data.core_tenants[].id')
for file in core/workflow/fixtures/*.bpmn20.xml; do
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

# Khai báo bước của quy trình mẫu cho mọi tenant (bảng platform.workflow_steps). Ví dụ của hợp đồng viết cho
# core-approval nên cũng là khai báo của nó; `make check-fast` đã kiểm tệp theo schema và theo BPMN. Khai báo của
# gói đi cùng BPMN của gói, do bộ cài gói nạp. Bước không còn trong tệp bị xóa, để chạy lại seed sau khi sửa tệp
# cho kết quả như trên dữ liệu trắng.
file=contracts/examples/workflow.example.yaml
declaration=$(uv run --quiet --no-project --with pyyaml==6.0.3 python -c \
  'import json, sys, yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1], encoding="utf-8"))))' "$file")
docker compose exec -T postgres psql -qX -v ON_ERROR_STOP=1 --username hasura --dbname mortise \
  -v declaration="$declaration" <<'SQL'
BEGIN;
CREATE TEMP TABLE declaration ON COMMIT DROP AS SELECT :'declaration'::jsonb AS d;
DELETE FROM platform.workflow_steps w USING declaration
WHERE w.process = d->>'process' AND NOT (d->'steps' ? w.step);
INSERT INTO platform.workflow_steps (tenant_id, process, step, config)
SELECT t.id, d->>'process', s.key, s.value
FROM core.tenants t, declaration, jsonb_each(d->'steps') s
ON CONFLICT (tenant_id, process, step) DO UPDATE SET config = EXCLUDED.config, updated_at = now()
    WHERE platform.workflow_steps.config IS DISTINCT FROM EXCLUDED.config;
COMMIT;
SQL
echo "postgres: khai báo bước $(jq -r .process <<<"$declaration") từ $file"

# Tài khoản MQTT của các thiết bị demo (ADR 0012), cùng mật khẩu DEMO_DEVICE_PASSWORD để bộ giả lập đăng nhập
# được. Danh sách thiết bị nằm ở devices/simulator/devices.yaml, chung với bộ giả lập.
: "${DEMO_DEVICE_PASSWORD:?Thiếu DEMO_DEVICE_PASSWORD trong .env; chạy make env}"
uv run --quiet --no-project --with pyyaml==6.0.3 python -c '
import sys, yaml
for entry in yaml.safe_load(open(sys.argv[1], encoding="utf-8")):
    print(entry["tenant"], entry["device"])
' devices/simulator/devices.yaml | while read -r tenant device; do
  scripts/device.sh add "$tenant" "$device" "$DEMO_DEVICE_PASSWORD" | sed 's/^/mosquitto: /'
done
