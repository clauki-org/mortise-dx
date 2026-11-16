#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Hợp đồng API trong contracts/: kiểm schema và ví dụ, và giữ OpenAPI của workflow-api
# khớp với mã. `check` (gọi từ make check-fast) báo lỗi khi lệch; `write` (make contracts)
# xuất lại OpenAPI sau khi đổi route hay model; `token <tệp>` (gọi từ make smoke) kiểm claim
# của một token thật, để phiên bản công cụ kiểm chỉ ghim ở tệp này.
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-check}"
checker=(uvx --from check-jsonschema==0.29.4 check-jsonschema)
steps=(uv run --quiet --no-project --with pyyaml==6.0.3 python scripts/check-workflow-steps.py)

case "$mode" in
  check | write) ;;
  token)
    if [[ ! -f "${2:-}" ]]; then
      echo "Cách dùng: $0 token <tệp claim>; không thấy tệp '${2:-}'." >&2
      exit 2
    fi
    exec "${checker[@]}" -q --schemafile contracts/token-claims.schema.json "$2"
    ;;
  *)
    echo "Cách dùng: $0 [check | write | token <tệp claim>]" >&2
    exit 2
    ;;
esac

"${checker[@]}" --check-metaschema contracts/*.schema.json
"${checker[@]}" --schemafile contracts/token-claims.schema.json contracts/examples/token-claims.example.json
"${checker[@]}" --schemafile contracts/app.schema.json contracts/examples/app.example.yaml
"${checker[@]}" --schemafile contracts/workflow.schema.json contracts/examples/workflow.example.yaml
"${steps[@]}" --bpmn core/workflow/fixtures/*.bpmn20.xml --steps contracts/examples/workflow.example.yaml
# Gói thật, nếu đã có. Khai báo bước của một gói chỉ đối chiếu với BPMN của chính gói đó.
shopt -s nullglob globstar
apps=(apps/*/app.yaml)
if ((${#apps[@]})); then
  "${checker[@]}" --schemafile contracts/app.schema.json "${apps[@]}"
fi
for app in apps/*/; do
  declarations=("$app"workflows/*.yaml)
  if ((${#declarations[@]})); then
    "${checker[@]}" --schemafile contracts/workflow.schema.json "${declarations[@]}"
  fi
  "${steps[@]}" --bpmn "$app"**/*.bpmn20.xml --steps "${declarations[@]}"
done

# Ví dụ sai trong contracts/examples/invalid/ phải bị từ chối. Thiếu bước này, một schema
# bị nới lỏng vẫn qua mọi ví dụ đúng mà không ai biết nó không còn chặn được gì.
# Mỗi tệp phải phạm đúng một luật: nếu chỉ đòi "bị từ chối", tệp hỏng cú pháp hay tệp sai
# hai chỗ vẫn qua, và sửa một chỗ sai thành đúng sẽ không làm bước kiểm này báo lỗi. Lỗi phải
# đúng từng ký tự với lỗi ghi trong contracts/examples/expected-errors.txt: đếm số lỗi thôi thì
# tệp bị từ chối vì một lý do khác, sau khi schema đổi, vẫn qua.
expected=contracts/examples/expected-errors.txt
reject() {
  local schema="$1" file result want_path want_message
  shift
  if (($# == 0)); then
    echo "Không có ví dụ sai nào cho $schema trong contracts/examples/invalid/." >&2
    exit 1
  fi
  for file in "$@"; do
    if ! IFS=$'\t' read -r _ want_path want_message \
      < <(awk -F'\t' -v name="${file##*/}" '$1 == name { print; found = 1 } END { exit !found }' "$expected"); then
      echo "$file chưa có dòng lỗi mong đợi trong $expected." >&2
      exit 1
    fi
    result=$("${checker[@]}" --output-format json --schemafile "$schema" "$file" |
      jq -r 'if (.parse_errors // []) != [] then "hỏng cú pháp"
        elif (.errors | length) != 1 then "\(.errors | length) lỗi"
        else .errors[0] | [.path, .message] | @tsv end') || true
    if [[ "$result" != "$want_path"$'\t'"$want_message" ]]; then
      echo "$file phải gây đúng lỗi: $want_path, $want_message." >&2
      echo "Đang nhận: ${result:-không đọc được}." >&2
      exit 1
    fi
  done
  echo "ok -- $# ví dụ sai bị $schema từ chối đúng luật"
}
reject contracts/token-claims.schema.json contracts/examples/invalid/token-claims.*.json
reject contracts/app.schema.json contracts/examples/invalid/app.*.yaml
reject contracts/workflow.schema.json contracts/examples/invalid/workflow.*.yaml
# Hai mẫu tên ở trên quyết định tệp nào được kiểm. Tệp đặt sai tên sẽ nằm trong invalid/
# mà chưa từng bị kiểm, nên phải báo lỗi thay vì bỏ qua.
for file in contracts/examples/invalid/*; do
  case "${file##*/}" in
    token-claims.*.json | app.*.yaml | workflow.*.yaml) ;;
    *)
      echo "$file không được kiểm: tên phải theo mẫu token-claims.<lỗi>.json, app.<lỗi>.yaml hoặc workflow.<lỗi>.yaml." >&2
      exit 1
      ;;
  esac
done
# Chiều ngược: dòng của tệp đã xóa hay đổi tên nằm im trong expected-errors.txt mà không ai biết.
while IFS=$'\t' read -r name _; do
  [[ -z "$name" || "$name" == \#* || -f "contracts/examples/invalid/$name" ]] && continue
  echo "$expected có dòng cho $name, nhưng tệp này không có trong contracts/examples/invalid/." >&2
  exit 1
done <"$expected"

# OpenAPI sinh từ mã của từng dịch vụ. Nhập app.main cần biến môi trường của config.py; giá trị
# không được dùng vì không gọi mạng. Mỗi dịch vụ một môi trường ảo ngoài repo (xem Makefile).
openapi_of() {
  local service="$1"
  shift
  (cd "core/$service" && env "$@" PYTHONDONTWRITEBYTECODE=1 UV_PROJECT_ENVIRONMENT="${MORTISE_VENVS:-$HOME/.cache/mortise-dx}/$service-venv" \
    uv run --quiet --frozen python -c \
    'import json; from app.main import app; print(json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True))')
}

unused_keycloak=(KEYCLOAK_JWKS_URL=http://unused KEYCLOAK_ISSUER=http://unused)
check_openapi() {
  local service="$1" file="contracts/$1.openapi.json" generated
  shift
  generated=$(openapi_of "$service" "${unused_keycloak[@]}" "$@")
  if [[ "$mode" == write ]]; then
    printf '%s\n' "$generated" >"$file"
    echo "Đã xuất $file"
  elif ! diff -u "$file" <(printf '%s\n' "$generated"); then
    echo "OpenAPI của $service lệch với mã. Chạy 'make contracts' rồi commit $file." >&2
    exit 1
  fi
}

check_openapi workflow-api FLOWABLE_URL=http://unused FLOWABLE_USER=unused FLOWABLE_PASSWORD=unused
check_openapi files-api FILES_DB_HOST=unused FILES_DB_NAME=unused FILES_DB_USER=unused FILES_DB_PASSWORD=unused \
  S3_URL=http://unused S3_ACCESS_KEY=unused S3_SECRET_KEY=unused FILES_BUCKET=unused FILES_MAX_BYTES=1 \
  CLAMD_HOST=unused CLAMD_PORT=1 FILES_SCAN_TIMEOUT=1
