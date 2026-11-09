#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Hợp đồng API trong contracts/: kiểm schema và ví dụ, và giữ OpenAPI của workflow-api
# khớp với mã. `check` (gọi từ make check-fast) báo lỗi khi lệch; `write` (make contracts)
# xuất lại OpenAPI sau khi đổi route hay model.
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-check}"
checker=(uvx --from check-jsonschema==0.29.4 check-jsonschema)
openapi=contracts/workflow-api.openapi.json

"${checker[@]}" --check-metaschema contracts/*.schema.json
"${checker[@]}" --schemafile contracts/token-claims.schema.json contracts/examples/token-claims.example.json
"${checker[@]}" --schemafile contracts/app.schema.json contracts/examples/app.example.yaml
# Gói thật, nếu đã có.
shopt -s nullglob
apps=(apps/*/app.yaml)
if ((${#apps[@]})); then
  "${checker[@]}" --schemafile contracts/app.schema.json "${apps[@]}"
fi

# Nhập app.main cần biến môi trường của config.py; giá trị không được dùng vì không gọi mạng.
generated=$(cd core/workflow-api && KEYCLOAK_JWKS_URL=http://unused KEYCLOAK_ISSUER=http://unused \
  FLOWABLE_URL=http://unused FLOWABLE_USER=unused FLOWABLE_PASSWORD=unused \
  uv run --frozen python -c \
  'import json; from app.main import app; print(json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True))')

if [[ "$mode" == write ]]; then
  printf '%s\n' "$generated" > "$openapi"
  echo "Đã xuất $openapi"
elif ! diff -u "$openapi" <(printf '%s\n' "$generated"); then
  echo "OpenAPI của workflow-api lệch với mã. Chạy 'make contracts' rồi commit $openapi." >&2
  exit 1
fi
