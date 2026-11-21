#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Hợp đồng API trong contracts/: kiểm schema và ví dụ, và giữ OpenAPI của các dịch vụ tự viết
# (workflow-api, files-api, context-api) khớp với mã. `check` (gọi từ make check-fast) báo lỗi khi lệch; `write` (make contracts)
# xuất lại OpenAPI sau khi đổi route hay model; `token <tệp>` (gọi từ make smoke) kiểm claim
# của một token thật, để phiên bản công cụ kiểm chỉ ghim ở tệp này.
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-check}"
checker=(uvx --from check-jsonschema==0.29.4 check-jsonschema)
yaml=(uv run --quiet --no-project --with pyyaml==6.0.3 python)
steps=("${yaml[@]}" scripts/check-workflow-steps.py)

case "$mode" in
  check | write) ;;
  token)
    if [[ ! -f "${2:-}" ]]; then
      echo "Cách dùng: $0 token <tệp claim>; không thấy tệp '${2:-}'." >&2
      exit 2
    fi
    exec "${checker[@]}" -q --schemafile contracts/token-claims.schema.json "$2"
    ;;
  service-token)
    if [[ ! -f "${2:-}" ]]; then
      echo "Cách dùng: $0 service-token <tệp claim>; không thấy tệp '${2:-}'." >&2
      exit 2
    fi
    exec "${checker[@]}" -q --schemafile contracts/service-token-claims.schema.json "$2"
    ;;
  *)
    echo "Cách dùng: $0 [check | write | token <tệp claim> | service-token <tệp claim>]" >&2
    exit 2
    ;;
esac

"${checker[@]}" --check-metaschema contracts/*.schema.json
"${checker[@]}" --schemafile contracts/token-claims.schema.json contracts/examples/token-claims.example.json
"${checker[@]}" --schemafile contracts/service-token-claims.schema.json \
  contracts/examples/service-token-claims.example.json
"${checker[@]}" --schemafile contracts/app.schema.json contracts/examples/app.example.yaml
"${checker[@]}" --schemafile contracts/workflow.schema.json contracts/examples/workflow.example.yaml
"${checker[@]}" --schemafile contracts/catalog.schema.json contracts/examples/catalog.example.yaml
"${checker[@]}" --schemafile contracts/assistant.schema.json contracts/examples/assistant.example.yaml
"${checker[@]}" --schemafile contracts/knowledge.schema.json contracts/examples/knowledge.example.yaml \
  contracts/examples/knowledge-amendment.example.yaml
"${checker[@]}" --schemafile contracts/threshold-rule.schema.json contracts/examples/threshold-rule.example.yaml
"${checker[@]}" --schemafile contracts/seed.schema.json contracts/examples/seed.example.yaml
# Bản mô tả của từng thành phần Tầng 2. Tên tệp, tên thành phần và hai đường dẫn trong tệp phải khớp nhau: bản mô tả
# trỏ tới schema hay ví dụ đã đổi tên là thứ người đọc và công cụ không tự phát hiện được.
for description in contracts/*.component.yaml; do
  "${checker[@]}" --schemafile contracts/component.schema.json "$description"
  { read -r component; read -r config_schema; read -r example; } < <("${yaml[@]}" -c '
import sys, yaml
described = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
print(described["component"]); print(described["config_schema"]); print(described["example"])
' "$description")
  if [[ "contracts/$component.component.yaml" != "$description" ]]; then
    echo "$description khai component: $component; tên tệp phải là $component.component.yaml." >&2
    exit 1
  fi
  for file in "$config_schema" "$example"; do
    if [[ ! -f "contracts/$file" ]]; then
      echo "$description trỏ tới contracts/$file, tệp này không có." >&2
      exit 1
    fi
  done
done
"${checker[@]}" --schemafile contracts/device-message.schema.json contracts/examples/device-message.example.json
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
  # Cấu hình của thành phần có schema nằm ở đường dẫn do app.yaml khai, không theo tên thư mục cố định, nên phải
  # đọc app.yaml để biết tệp nào cần kiểm; dò theo tên thư mục sẽ bỏ sót tệp đặt ở chỗ khác.
  for component in catalog assistant; do
    mapfile -t configs < <("${yaml[@]}" -c '
import sys, yaml
app = yaml.safe_load(open(sys.argv[1] + "app.yaml", encoding="utf-8"))
for item in app.get("menu", []):
    if item["component"] == sys.argv[2]:
        print(sys.argv[1] + item["config"])
' "$app" "$component")
    if ((${#configs[@]})); then
      "${checker[@]}" --schemafile "contracts/$component.schema.json" "${configs[@]}"
    fi
  done
  # Luật ngưỡng (mục `rules`) và văn bản cho trợ lý (mục `knowledge`) cũng nằm ở đường dẫn do app.yaml khai.
  for entry in rules:threshold-rule knowledge:knowledge; do
    mapfile -t files < <("${yaml[@]}" -c '
import sys, yaml
app = yaml.safe_load(open(sys.argv[1] + "app.yaml", encoding="utf-8"))
for path in app.get(sys.argv[2], []):
    print(sys.argv[1] + path)
' "$app" "${entry%%:*}")
    if ((${#files[@]})); then
      "${checker[@]}" --schemafile "contracts/${entry#*:}.schema.json" "${files[@]}"
    fi
  done
  # Dữ liệu demo khai báo: chỉ gói không có bộ nạp riêng (seed/load.py) mới dùng định dạng chung, vì make seed-demo
  # chạy bộ nạp riêng nếu có và bỏ qua demo.yaml của gói đó.
  if [[ -f "${app}seed/demo.yaml" && ! -f "${app}seed/load.py" ]]; then
    "${checker[@]}" --schemafile contracts/seed.schema.json "${app}seed/demo.yaml"
  fi
done
# Khóa quy trình là duy nhất trên cả lõi và mọi gói: bộ cài gói (scripts/app-deploy.py) xóa khai báo bước và
# deployment theo khóa, nên một gói khai trùng khóa với lõi hay gói khác sẽ xóa luôn quy trình của bên kia khi cài
# lại hay khi gỡ.
"${steps[@]}" --bpmn core/workflow/fixtures/*.bpmn20.xml apps/**/*.bpmn20.xml \
  --steps contracts/examples/workflow.example.yaml apps/*/workflows/*.yaml

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
reject contracts/service-token-claims.schema.json contracts/examples/invalid/service-token-claims.*.json
reject contracts/app.schema.json contracts/examples/invalid/app.*.yaml
reject contracts/workflow.schema.json contracts/examples/invalid/workflow.*.yaml
reject contracts/catalog.schema.json contracts/examples/invalid/catalog.*.yaml
reject contracts/assistant.schema.json contracts/examples/invalid/assistant.*.yaml
reject contracts/knowledge.schema.json contracts/examples/invalid/knowledge.*.yaml
reject contracts/threshold-rule.schema.json contracts/examples/invalid/threshold-rule.*.yaml
reject contracts/seed.schema.json contracts/examples/invalid/seed.*.yaml
reject contracts/component.schema.json contracts/examples/invalid/component.*.yaml
reject contracts/device-message.schema.json contracts/examples/invalid/device-message.*.json
# Các mẫu tên ở trên quyết định tệp nào được kiểm. Tệp đặt sai tên sẽ nằm trong invalid/
# mà chưa từng bị kiểm, nên phải báo lỗi thay vì bỏ qua.
for file in contracts/examples/invalid/*; do
  case "${file##*/}" in
    token-claims.*.json | service-token-claims.*.json | device-message.*.json | app.*.yaml | workflow.*.yaml | catalog.*.yaml | component.*.yaml | \
    threshold-rule.*.yaml | assistant.*.yaml | knowledge.*.yaml | seed.*.yaml) ;;
    *)
      echo "$file không được kiểm: tên phải theo mẫu <token-claims|service-token-claims|device-message>.<lỗi>.json hoặc" \
        "<app|workflow|catalog|component|threshold-rule|assistant|knowledge|seed>.<lỗi>.yaml." >&2
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
check_openapi context-api SCORPIO_URL=http://unused
