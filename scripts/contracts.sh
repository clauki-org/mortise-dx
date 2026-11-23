#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Hợp đồng API trong contracts/: kiểm schema và ví dụ, và giữ OpenAPI của các dịch vụ tự viết
# (workflow-api, files-api, context-api, assistant) khớp với mã. `check` (gọi từ make check-fast) báo lỗi khi lệch; `write` (make contracts)
# xuất lại OpenAPI sau khi đổi route hay model; `token <tệp>` (gọi từ make smoke) kiểm claim
# của một token thật; `config <thành phần> <tệp>` (gọi từ scripts/app-deploy.py) kiểm tệp cấu hình của một thành
# phần theo contracts/<thành phần>.schema.json; `assistant-data <gói | core> <tệp>` (cũng từ app-deploy.py) kiểm mục
# `data` của cấu hình trợ lý với quyền Hasura của chủ sở hữu và chạy câu mẫu qua guard. Các lệnh đó gọi qua đây để
# phiên bản công cụ kiểm chỉ ghim ở tệp này.
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-check}"
checker=(uvx --from check-jsonschema==0.29.4 check-jsonschema)
yaml=(uv run --quiet --no-project --with pyyaml==6.0.3 python)
steps=("${yaml[@]}" scripts/check-workflow-steps.py)
# Câu mẫu của trợ lý dữ liệu phải qua đúng guard và đúng bản graphql-core mà dịch vụ chạy, nên đọc số phiên bản từ
# pyproject.toml của dịch vụ thay vì ghim lần thứ hai ở đây.
graphql_core=$(sed -n 's/^ *"graphql-core==\([0-9.]*\)",$/\1/p' platform/services/assistant/pyproject.toml)
if [[ -z "$graphql_core" ]]; then
  echo "Không đọc được phiên bản graphql-core ghim trong platform/services/assistant/pyproject.toml." >&2
  exit 1
fi
data_check=(uv run --quiet --no-project --with pyyaml==6.0.3 --with "graphql-core==$graphql_core" python
  scripts/check-assistant-data.py)

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
  config)
    # Tên thành phần thành một phần đường dẫn, nên chỉ nhận chữ thường; không có schema thì báo thay vì bỏ qua.
    if [[ ! "${2:-}" =~ ^[a-z]+$ || ! -f "contracts/${2:-}.schema.json" || ! -f "${3:-}" ]]; then
      echo "Cách dùng: $0 config <thành phần có contracts/<thành phần>.schema.json> <tệp cấu hình>." >&2
      exit 2
    fi
    # Không dùng -q: lỗi schema là thứ người gọi cần đọc.
    exec "${checker[@]}" --schemafile "contracts/$2.schema.json" "$3"
    ;;
  assistant-data)
    if [[ -z "${2:-}" || ! -f "${3:-}" ]]; then
      echo "Cách dùng: $0 assistant-data <apps/<gói> | core> <tệp cấu hình trợ lý>." >&2
      exit 2
    fi
    exec "${data_check[@]}" --owner "$2" "$3"
    ;;
  *)
    echo "Cách dùng: $0 [check | write | token <tệp claim> | service-token <tệp claim> | config <thành phần> <tệp> |" \
      "assistant-data <gói | core> <tệp>]" >&2
    exit 2
    ;;
esac

"${checker[@]}" --check-metaschema contracts/*.schema.json
"${checker[@]}" --schemafile contracts/token-claims.schema.json contracts/examples/token-claims.example.json
"${checker[@]}" --schemafile contracts/service-token-claims.schema.json \
  contracts/examples/service-token-claims.example.json
"${checker[@]}" --schemafile contracts/app.schema.json contracts/examples/app.example.yaml
# Khai báo bước của các quy trình mẫu của lõi: ví dụ của hợp đồng (core-approval) và tệp cạnh BPMN mẫu.
"${checker[@]}" --schemafile contracts/workflow.schema.json contracts/examples/workflow.example.yaml \
  core/workflow/fixtures/*.yaml
"${checker[@]}" --schemafile contracts/authority.schema.json contracts/examples/authority.example.yaml
"${checker[@]}" --schemafile contracts/catalog.schema.json contracts/examples/catalog.example.yaml
"${checker[@]}" --schemafile contracts/map.schema.json contracts/examples/map.example.yaml
"${checker[@]}" --schemafile contracts/form.schema.json contracts/examples/form.example.yaml
"${checker[@]}" --schemafile contracts/cases.schema.json contracts/examples/cases.example.yaml
"${checker[@]}" --schemafile contracts/dashboard.schema.json contracts/examples/dashboard.example.yaml
"${checker[@]}" --schemafile contracts/assistant.schema.json contracts/examples/assistant.example.yaml \
  contracts/examples/assistant-data.example.yaml
"${data_check[@]}" --owner core contracts/examples/assistant-data.example.yaml
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
"${steps[@]}" --bpmn core/workflow/fixtures/*.bpmn20.xml \
  --steps contracts/examples/workflow.example.yaml core/workflow/fixtures/*.yaml \
  --authorities contracts/examples/authority.example.yaml --rules contracts/examples/threshold-rule.example.yaml
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
  "${steps[@]}" --bpmn "$app"**/*.bpmn20.xml --steps "${declarations[@]}" --packages "$app"
  # Cấu hình của thành phần có schema nằm ở đường dẫn do app.yaml khai, không theo tên thư mục cố định, nên phải
  # đọc app.yaml để biết tệp nào cần kiểm; dò theo tên thư mục sẽ bỏ sót tệp đặt ở chỗ khác.
  for component in catalog map assistant form cases dashboard; do
    mapfile -t configs < <("${yaml[@]}" -c '
import sys, yaml
app = yaml.safe_load(open(sys.argv[1] + "app.yaml", encoding="utf-8"))
for item in app.get("menu", []):
    if item["component"] == sys.argv[2]:
        print(sys.argv[1] + item["config"])
' "$app" "$component")
    if ((${#configs[@]})); then
      "${checker[@]}" --schemafile "contracts/$component.schema.json" "${configs[@]}"
      # Nút của danh mục chỉ mở quy trình của chính gói này (ADR 0026), nên đối chiếu với BPMN của gói.
      if [[ "$component" == catalog ]]; then
        "${yaml[@]}" scripts/check-catalog-actions.py --bpmn "$app"**/*.bpmn20.xml --catalog "${configs[@]}"
      fi
      # Trợ lý dữ liệu chỉ hỏi bảng của chính gói, trong quyền đọc của vai trò user (ADR 0027).
      if [[ "$component" == assistant ]]; then
        "${data_check[@]}" --owner "${app%/}" "${configs[@]}"
      fi
      # Biểu mẫu chỉ gửi tới quy trình hay bảng của chính gói này (ADR 0030); tệp lấy theo app.yaml như ở trên.
      if [[ "$component" == form ]]; then
        "${yaml[@]}" scripts/check-form-config.py --app "${app}app.yaml"
      fi
      # Trang theo dõi hồ sơ chỉ liệt kê quy trình của chính gói này (ADR 0032).
      if [[ "$component" == cases ]]; then
        "${yaml[@]}" scripts/check-cases-config.py --bpmn "$app"**/*.bpmn20.xml --cases "${configs[@]}"
      fi
      # Bảng điều hành chỉ đọc bảng của chính gói, trong quyền đọc của vai trò từng khối (ADR 0033).
      if [[ "$component" == dashboard ]]; then
        "${yaml[@]}" scripts/check-dashboard-config.py --app "${app}app.yaml"
      fi
    fi
  done
  # Luật ngưỡng (mục `rules`), văn bản cho trợ lý (mục `knowledge`) và bảng phân cấp (mục `authorities`) cũng nằm ở
  # đường dẫn do app.yaml khai.
  for entry in rules:threshold-rule knowledge:knowledge authorities:authority; do
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
  --steps contracts/examples/workflow.example.yaml core/workflow/fixtures/*.yaml apps/*/workflows/*.yaml \
  --authorities contracts/examples/authority.example.yaml --rules contracts/examples/threshold-rule.example.yaml \
  --packages apps/*/

# Ví dụ sai của bước kiểm BPMN với khai báo bước, luật ngưỡng và danh mục (scripts/check-workflow-steps.py): mỗi thư
# mục trong contracts/examples/invalid-steps/ là một quy trình (process.bpmn20.xml, steps.yaml, có thể có rule.yaml
# và catalog.yaml) phạm đúng một luật, và lỗi phải đúng từng ký tự với expected.txt của thư mục, như ví dụ sai của
# schema ở dưới: bước kiểm bị nới lỏng hay hỏng mà vẫn qua mọi tệp thật thì không ai biết.
cases=(contracts/examples/invalid-steps/*/)
for case in "${cases[@]}"; do
  args=(--bpmn "${case}process.bpmn20.xml" --steps "${case}steps.yaml")
  [[ -f "${case}rule.yaml" ]] && args+=(--rules "${case}rule.yaml")
  [[ -f "${case}catalog.yaml" ]] && args+=(--catalogs "${case}catalog.yaml")
  if result=$("${steps[@]}" "${args[@]}" 2>&1); then
    echo "$case phải bị scripts/check-workflow-steps.py từ chối mà lại qua." >&2
    exit 1
  fi
  if [[ "$result" != "$(grep -v '^#' "${case}expected.txt")" ]]; then
    echo "$case phải gây đúng lỗi trong ${case}expected.txt. Đang nhận:" >&2
    echo "$result" >&2
    exit 1
  fi
done
echo "ok -- ${#cases[@]} ví dụ sai bị scripts/check-workflow-steps.py từ chối đúng luật"

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
reject contracts/map.schema.json contracts/examples/invalid/map.*.yaml
reject contracts/form.schema.json contracts/examples/invalid/form.*.yaml
reject contracts/cases.schema.json contracts/examples/invalid/cases.*.yaml
reject contracts/dashboard.schema.json contracts/examples/invalid/dashboard.*.yaml
reject contracts/assistant.schema.json contracts/examples/invalid/assistant.*.yaml
reject contracts/knowledge.schema.json contracts/examples/invalid/knowledge.*.yaml
reject contracts/threshold-rule.schema.json contracts/examples/invalid/threshold-rule.*.yaml
reject contracts/authority.schema.json contracts/examples/invalid/authority.*.yaml
reject contracts/seed.schema.json contracts/examples/invalid/seed.*.yaml
reject contracts/component.schema.json contracts/examples/invalid/component.*.yaml
reject contracts/device-message.schema.json contracts/examples/invalid/device-message.*.json
# Các mẫu tên ở trên quyết định tệp nào được kiểm. Tệp đặt sai tên sẽ nằm trong invalid/
# mà chưa từng bị kiểm, nên phải báo lỗi thay vì bỏ qua.
for file in contracts/examples/invalid/*; do
  case "${file##*/}" in
    token-claims.*.json | service-token-claims.*.json | device-message.*.json | app.*.yaml | workflow.*.yaml | catalog.*.yaml | component.*.yaml | \
    threshold-rule.*.yaml | authority.*.yaml | assistant.*.yaml | knowledge.*.yaml | seed.*.yaml | map.*.yaml | form.*.yaml | \
    cases.*.yaml | dashboard.*.yaml) ;;
    *)
      echo "$file không được kiểm: tên phải theo mẫu <token-claims|service-token-claims|device-message>.<lỗi>.json hoặc" \
        "<app|workflow|catalog|map|form|cases|dashboard|component|threshold-rule|authority|assistant|knowledge|seed>.<lỗi>.yaml." >&2
      exit 1
      ;;
  esac
done
# Luật của scripts/check-form-config.py cũng phải chặn được thật: biểu mẫu sai đọc từ stdin, đối chiếu với quy trình
# mẫu core-approval, khai báo bước mẫu và một bảng mẫu (hay bảng trong biến tables nếu đặt); mỗi biểu mẫu phạm đúng
# một luật và lỗi phải đúng từng ký tự.
# Thiếu bước này, một luật bị nới (ví dụ quên biến quyết định) vẫn qua mọi biểu mẫu đúng của gói mà không ai biết.
form_tables='- table: { schema: app_example, name: items }
  insert_permissions:
    - role: tenant_admin
      permission: { columns: [code, name], check: {}, set: { tenant_id: X-Hasura-Tenant-Id } }'
form_rejects() { # LỖI_MONG_ĐỢI, biểu mẫu ở stdin
  local result
  result=$("${yaml[@]}" scripts/check-form-config.py --app contracts/examples/app.example.yaml \
    --bpmn core/workflow/fixtures/core-approval.bpmn20.xml --steps contracts/examples/workflow.example.yaml \
    --hasura <(printf '%s\n' "${tables:-$form_tables}") --form /dev/stdin 2>&1) && result="không bị từ chối"
  if [[ "$result" != "/dev/stdin: $1" ]]; then
    echo "check-form-config.py phải báo đúng lỗi: $1" >&2
    echo "Đang nhận: $result" >&2
    exit 1
  fi
}
form_rejects "trường 'approved' là biến quyết định của quy trình 'core-approval'; người lập không được đặt sẵn" <<'YAML'
title: Yêu cầu
fields: [{ name: title, label: Tên, type: string }, { name: approved, label: Duyệt, type: boolean }]
submit: { label: Gửi, process: core-approval }
done: { message: Đã gửi }
YAML
form_rejects "trường 'comment' trùng biến mà một bước của quy trình 'core-approval' ghi; giá trị người lập điền sẽ \
hiện dưới nhãn của người xử lý, đổi tên trường" <<'YAML'
title: Yêu cầu
fields: [{ name: title, label: Tên, type: string }, { name: comment, label: Ý kiến, type: string }]
submit: { label: Gửi, process: core-approval }
done: { message: Đã gửi }
YAML
form_rejects "bước của quy trình 'core-approval' lấy tên hồ sơ từ biến 'title'; thêm trường 'title'" <<'YAML'
title: Yêu cầu
fields: [{ name: note, label: Ghi chú, type: string }]
submit: { label: Gửi, process: core-approval }
done: { message: Đã gửi }
YAML
form_rejects "cột 'tenant_id' do Hasura đặt từ token (set); bỏ trường này khỏi biểu mẫu" <<'YAML'
title: Thêm
role: tenant_admin
fields: [{ name: code, label: Mã, type: string }, { name: tenant_id, label: Đơn vị, type: string }]
submit: { label: Thêm, insert: app_example_items }
done: { message: Đã thêm }
YAML
# Quyền ghi tenant_id trong columns thay vì set: check vẫn buộc đúng tenant, nhưng ô đó vô nghĩa với người dùng và
# trái nguyên tắc trình duyệt không gửi tenant.
tables='- table: { schema: app_example, name: items }
  insert_permissions:
    - role: tenant_admin
      permission: { columns: [code, tenant_id], check: { tenant_id: { _eq: X-Hasura-Tenant-Id } } }' \
  form_rejects "cột 'tenant_id' là cột tenant của 'app_example_items'; trình duyệt không gửi tenant: bỏ trường này \
khỏi biểu mẫu và đặt cột bằng set: { tenant_id: X-Hasura-Tenant-Id } trong quyền thêm dòng của gói" <<'YAML'
title: Thêm
role: tenant_admin
fields: [{ name: code, label: Mã, type: string }, { name: tenant_id, label: Đơn vị, type: string }]
submit: { label: Thêm, insert: app_example_items }
done: { message: Đã thêm }
YAML
# Tệp quyền sai dạng phải thành một dòng lỗi chỉ tệp và mục, không phải traceback của Python.
result=$("${yaml[@]}" scripts/check-form-config.py --app contracts/examples/app.example.yaml \
  --bpmn core/workflow/fixtures/core-approval.bpmn20.xml --steps contracts/examples/workflow.example.yaml \
  --hasura <(printf '%s\n' '- table: { schema: app_example, name: items }' '  insert_permissions: [{ permission: {} }]') \
  --form contracts/examples/form.example.yaml 2>&1) && result="không bị từ chối"
if [[ "$result" != *": mục 1: một mục của insert_permissions thiếu role; sửa theo dạng của core/hasura/tables.yaml" ||
  "$result" == *Traceback* ]]; then
  echo "check-form-config.py phải báo tệp quyền sai dạng bằng một dòng lỗi. Đang nhận: $result" >&2
  exit 1
fi
echo "ok -- 6 biểu mẫu và tệp quyền sai bị check-form-config.py từ chối đúng luật"
# Luật của scripts/check-cases-config.py cũng phải chặn được thật: trang theo dõi hồ sơ liệt kê quy trình không có
# trong BPMN của gói (ở đây chỉ có core-approval).
result=$("${yaml[@]}" scripts/check-cases-config.py --bpmn core/workflow/fixtures/core-approval.bpmn20.xml \
  --cases <(printf '%s\n' 'title: Hồ sơ' 'processes: [core-approval, core-handoff]') 2>&1) && result="không bị từ chối"
if [[ "$result" != *": quy trình 'core-handoff' không có trong BPMN của gói; sửa khóa hoặc thêm quy trình vào workflows" ]]; then
  echo "check-cases-config.py phải từ chối quy trình ngoài gói. Đang nhận: $result" >&2
  exit 1
fi
echo "ok -- cấu hình theo dõi hồ sơ trỏ tới quy trình ngoài gói bị check-cases-config.py từ chối"

# Luật của scripts/check-dashboard-config.py, như của biểu mẫu ở trên: cấu hình sai đọc từ stdin, đối chiếu với menu
# của app.example.yaml, bảng quyền mẫu dưới đây và BPMN của quy trình mẫu core-approval (thay cho BPMN của gói); mỗi
# cấu hình phạm đúng một luật và lỗi phải đúng từng ký tự. Ví dụ đúng của hợp đồng cũng phải qua bước này, để ví dụ
# không lệch với luật mà không ai biết.
dashboard_tables='- table: { schema: app_example, name: totals }
  select_permissions:
    - role: user
      permission: { columns: [tenant_id, item_count, score], filter: { tenant_id: { _eq: X-Hasura-Tenant-Id } } }
- table: { schema: app_example, name: rollup }
  select_permissions:
    - role: rollup_reader
      permission: { columns: "*", filter: { parent_tenant_id: { _eq: X-Hasura-Tenant-Id } } }'
dashboard_check() { # TỆP_CẤU_HÌNH [BẢNG_QUYỀN]
  "${yaml[@]}" scripts/check-dashboard-config.py --app contracts/examples/app.example.yaml \
    --hasura <(printf '%s\n' "${2:-$dashboard_tables}") --bpmn core/workflow/fixtures/core-approval.bpmn20.xml \
    --dashboard "$1" 2>&1
}
dashboard_check contracts/examples/dashboard.example.yaml
# Nguồn workflow và context đúng luật (ADR 0035) phải qua.
dashboard_check /dev/stdin <<'YAML'
title: Tổng quan
panels:
  - id: cases
    title: Hồ sơ
    description: Số hồ sơ của đơn vị.
    role: manager
    workflow: { process: core-approval, counts: tenant }
    cards: [{ column: finished, label: Đã xong, description: Hồ sơ đã kết thúc. }]
  - id: steps
    title: Việc của tôi
    description: Việc đang chờ người xem theo bước.
    workflow: { process: core-approval, counts: mine }
    chart: { type: bar, x: { column: step, label: Bước }, y: [{ column: overdue, label: Quá hạn, color: red }] }
  - id: readings
    title: Số đo
    description: Số đo mới nhất.
    context: { type: Device, attribute: level }
    chart:
      type: bar
      x: { column: id, label: Thiết bị }
      y: [{ column: value, label: Mức, color: blue }]
      details: [{ column: observedAt, label: Lúc đo }]
YAML
dashboard_rejects() { # LỖI_MONG_ĐỢI, cấu hình ở stdin
  local result
  result=$(dashboard_check /dev/stdin) && result="không bị từ chối"
  if [[ "$result" != "/dev/stdin: $1" ]]; then
    echo "check-dashboard-config.py phải báo đúng lỗi: $1" >&2
    echo "Đang nhận: $result" >&2
    exit 1
  fi
}
dashboard_rejects "khối 'flow': quy trình 'core-handoff' không có trong BPMN của gói; sửa khóa hoặc thêm quy trình \
vào workflows" <<'YAML'
title: Tổng quan
panels:
  - id: flow
    title: Hồ sơ
    description: Quy trình ngoài gói.
    workflow: { process: core-handoff, counts: tenant }
    cards: [{ column: open, label: Còn mở, description: Hồ sơ còn mở. }]
YAML
dashboard_rejects "khối 'mine': cards không có giá trị 'finished'; dùng open, overdue" <<'YAML'
title: Tổng quan
panels:
  - id: mine
    title: Việc của tôi
    description: Việc của người xem không có số đã kết thúc.
    workflow: { process: core-approval, counts: mine }
    cards: [{ column: finished, label: Đã xong, description: Không có. }]
YAML
dashboard_rejects "khối 'r': context.attribute 'level&q=x' không phải tên (chữ, số, gạch dưới)" <<'YAML'
title: Tổng quan
panels:
  - id: r
    title: Số đo
    description: Tên số đo ghép thêm tham số.
    context: { type: Device, attribute: "level&q=x" }
    chart: { type: bar, x: { column: id, label: Thiết bị }, y: [{ column: value, label: Mức, color: blue }] }
YAML
dashboard_rejects "khối 'r': chart.x không có giá trị 'observedAt'; dùng id" <<'YAML'
title: Tổng quan
panels:
  - id: r
    title: Số đo
    description: Trục theo lúc đo.
    context: { type: Device, attribute: level }
    chart: { type: bar, x: { column: observedAt, label: Lúc }, y: [{ column: value, label: Mức, color: blue }] }
YAML
dashboard_rejects "khối 't': graphql.field 'app_other_totals' không phải bảng trong quyền Hasura của gói" <<'YAML'
title: Tổng quan
panels:
  - id: t
    title: Tổng
    description: Bảng của gói khác.
    graphql: { field: app_other_totals }
    cards: [{ column: score, label: Điểm, description: Tổng điểm. }]
YAML
dashboard_rejects "khối 't': vai trò 'user' không đọc được 'app_example_rollup'; sửa role hoặc quyền của gói" <<'YAML'
title: Tổng quan
panels:
  - id: t
    title: Đơn vị con
    description: View tổng hợp, quên role.
    graphql: { field: app_example_rollup }
    chart: { type: bar, x: { column: unit_name, label: Đơn vị }, y: [{ column: score, label: Điểm, color: teal }] }
YAML
dashboard_rejects "khối 't': vai trò 'user' không đọc được cột 'secret' của 'app_example_totals'" <<'YAML'
title: Tổng quan
panels:
  - id: t
    title: Tổng
    description: Lọc theo cột ngoài quyền.
    graphql: { field: app_example_totals, where: { field: secret, equals: x } }
    cards: [{ column: score, label: Điểm, description: Tổng điểm. }]
YAML
dashboard_rejects "khối 't': link.menu 'nowhere' không phải mục menu khác của gói" <<'YAML'
title: Tổng quan
panels:
  - id: t
    title: Tổng
    description: Đường dẫn tới mục không có.
    graphql: { field: app_example_totals }
    cards: [{ column: score, label: Điểm, description: Tổng điểm. }]
    link: { menu: nowhere, label: Xem }
YAML
dashboard_rejects "khối 't': cột 'score' khai hai lần trong chart.y" <<'YAML'
title: Tổng quan
panels:
  - id: t
    title: Đơn vị con
    description: Hai thanh cùng một cột.
    role: rollup_reader
    graphql: { field: app_example_rollup }
    chart:
      type: bar
      x: { column: unit_name, label: Đơn vị }
      y: [{ column: score, label: Điểm, color: teal }, { column: score, label: Lại điểm, color: red }]
YAML
dashboard_rejects "khối 't' được khai hai lần" <<'YAML'
title: Tổng quan
panels:
  - id: t
    title: A
    description: Khối đầu.
    graphql: { field: app_example_totals }
    cards: [{ column: score, label: A, description: A. }]
  - id: t
    title: B
    description: Khối sau cùng tên.
    graphql: { field: app_example_totals }
    cards: [{ column: item_count, label: B, description: B. }]
YAML
# Cấu hình sai dạng (lệnh chạy riêng với --dashboard, chưa qua schema) phải thành một dòng lỗi, không traceback.
dashboard_rejects "cần panels là danh sách khối không rỗng; sửa theo contracts/dashboard.schema.json" <<'YAML'
title: Tổng quan
YAML
dashboard_rejects "khối thứ 1 thiếu id; sửa theo contracts/dashboard.schema.json" <<'YAML'
title: Tổng quan
panels:
  - { title: Tổng, description: Thiếu id., graphql: { field: app_example_totals }, cards: [] }
YAML
dashboard_rejects "khối 't': thiếu nguồn: cần graphql: { field: <lược đồ>_<bảng> }; sửa theo \
contracts/dashboard.schema.json" <<'YAML'
title: Tổng quan
panels:
  - { id: t, title: Tổng, description: Thiếu nguồn., cards: [{ column: score, label: Điểm, description: Điểm. }] }
YAML
# Hasura bắt buộc columns trong quyền select; thiếu là tệp quyền sai dạng, không coi là mọi cột hay không cột nào.
result=$(dashboard_check contracts/examples/dashboard.example.yaml $'- table: { schema: app_example, name: totals }
  select_permissions: [{ role: user, permission: { filter: {} } }]') && result="không bị từ chối"
if [[ "$result" != *': mục 1: quyền select_permissions, vai trò user thiếu columns (Hasura bắt buộc), cần là danh sách tên'\
' cột hoặc "*"; sửa theo dạng của core/hasura/tables.yaml' || "$result" == *Traceback* ]]; then
  echo "check-dashboard-config.py phải báo quyền select thiếu columns bằng một dòng lỗi. Đang nhận: $result" >&2
  exit 1
fi
result=$(dashboard_check contracts/examples/dashboard.example.yaml \
  $'- table: { schema: app_example, name: totals }\n  select_permissions: [{ permission: {} }]') && result="không bị từ chối"
if [[ "$result" != *": mục 1: một mục của select_permissions thiếu role; sửa theo dạng của core/hasura/tables.yaml" ||
  "$result" == *Traceback* ]]; then
  echo "check-dashboard-config.py phải báo tệp quyền sai dạng bằng một dòng lỗi. Đang nhận: $result" >&2
  exit 1
fi
echo "ok -- 15 bảng điều hành và tệp quyền sai bị check-dashboard-config.py từ chối đúng luật"

# Chiều ngược: dòng của tệp đã xóa hay đổi tên nằm im trong expected-errors.txt mà không ai biết.
while IFS=$'\t' read -r name _; do
  [[ -z "$name" || "$name" == \#* || -f "contracts/examples/invalid/$name" ]] && continue
  echo "$expected có dòng cho $name, nhưng tệp này không có trong contracts/examples/invalid/." >&2
  exit 1
done <"$expected"

# OpenAPI sinh từ mã của từng dịch vụ. Nhập app.main cần biến môi trường của config.py; giá trị
# không được dùng vì không gọi mạng. Mỗi dịch vụ một môi trường ảo ngoài repo (xem Makefile).
openapi_of() {
  local dir="$1" service="${1##*/}"
  shift
  (cd "$dir" && env "$@" PYTHONDONTWRITEBYTECODE=1 UV_PROJECT_ENVIRONMENT="${MORTISE_VENVS:-$HOME/.cache/mortise-dx}/$service-venv" \
    uv run --quiet --frozen python -c \
    'import json; from app.main import app; print(json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True))')
}

unused_keycloak=(KEYCLOAK_JWKS_URL=http://unused KEYCLOAK_ISSUER=http://unused)
check_openapi() {
  local dir="$1" service="${1##*/}" file="contracts/${1##*/}.openapi.json" generated
  shift
  generated=$(openapi_of "$dir" "${unused_keycloak[@]}" "$@")
  if [[ "$mode" == write ]]; then
    printf '%s\n' "$generated" >"$file"
    echo "Đã xuất $file"
  elif ! diff -u "$file" <(printf '%s\n' "$generated"); then
    echo "OpenAPI của $service lệch với mã. Chạy 'make contracts' rồi commit $file." >&2
    exit 1
  fi
}

check_openapi core/workflow-api FLOWABLE_URL=http://unused FLOWABLE_USER=unused FLOWABLE_PASSWORD=unused \
  WORKFLOW_DB_HOST=unused WORKFLOW_DB_NAME=unused WORKFLOW_DB_USER=unused WORKFLOW_DB_PASSWORD=unused
check_openapi core/files-api FILES_DB_HOST=unused FILES_DB_NAME=unused FILES_DB_USER=unused FILES_DB_PASSWORD=unused \
  S3_URL=http://unused S3_ACCESS_KEY=unused S3_SECRET_KEY=unused FILES_BUCKET=unused FILES_MAX_BYTES=1 \
  CLAMD_HOST=unused CLAMD_PORT=1 FILES_SCAN_TIMEOUT=1
check_openapi core/context-api SCORPIO_URL=http://unused
# Tên mô hình đọc từ tệp ghim thật lúc import, như trong container.
check_openapi platform/services/assistant ASSISTANT_GRAPHQL_URL=http://unused OLLAMA_URL=http://unused \
  ASSISTANT_MODELS_FILE="$PWD/core/ollama/models.txt" ASSISTANT_MAX_QUESTION_CHARS=1 ASSISTANT_MIN_SCORE=1 \
  ASSISTANT_TOP_PASSAGES=1 ASSISTANT_NUM_PREDICT=1 ASSISTANT_TIMEOUT_SECONDS=1 \
  ASSISTANT_DB_HOST=unused ASSISTANT_DB_NAME=unused ASSISTANT_DB_USER=unused ASSISTANT_DB_PASSWORD=unused
