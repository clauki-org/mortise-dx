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

# Ví dụ sai trong contracts/examples/invalid/ phải bị từ chối. Thiếu bước này, một schema
# bị nới lỏng vẫn qua mọi ví dụ đúng mà không ai biết nó không còn chặn được gì.
# Mỗi tệp phải phạm đúng một luật: nếu chỉ đòi "bị từ chối", tệp hỏng cú pháp hay tệp sai
# hai chỗ vẫn qua, và sửa một chỗ sai thành đúng sẽ không làm bước kiểm này báo lỗi.
reject() {
  local schema="$1" file violations
  shift
  if (($# == 0)); then
    echo "Không có ví dụ sai nào cho $schema trong contracts/examples/invalid/." >&2
    exit 1
  fi
  for file in "$@"; do
    violations=$("${checker[@]}" --output-format json --schemafile "$schema" "$file" |
      jq 'if (.parse_errors // []) == [] then .errors | length else -1 end') || true
    if [[ "$violations" != 1 ]]; then
      echo "$file phải phạm đúng một luật của $schema (đang phạm: ${violations:-không đọc được})." >&2
      echo "0: tệp hợp lệ, hoặc schema đã bị nới lỏng. -1: tệp hỏng cú pháp. Từ 2: tách thành nhiều tệp." >&2
      exit 1
    fi
  done
  echo "ok -- $# ví dụ sai bị $schema từ chối"
}
reject contracts/token-claims.schema.json contracts/examples/invalid/token-claims.*.json
reject contracts/app.schema.json contracts/examples/invalid/app.*.yaml
# Hai mẫu tên ở trên quyết định tệp nào được kiểm. Tệp đặt sai tên sẽ nằm trong invalid/
# mà chưa từng bị kiểm, nên phải báo lỗi thay vì bỏ qua.
for file in contracts/examples/invalid/*; do
  case "${file##*/}" in
    token-claims.*.json | app.*.yaml) ;;
    *)
      echo "$file không được kiểm: tên phải theo mẫu token-claims.<lỗi>.json hoặc app.<lỗi>.yaml." >&2
      exit 1
      ;;
  esac
done

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
