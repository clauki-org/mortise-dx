#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Hợp đồng API trong contracts/: kiểm schema và ví dụ, và giữ OpenAPI của các dịch vụ tự viết
# (workflow-api, files-api, context-api, assistant) khớp với mã. `check` (gọi từ make check-fast) báo lỗi khi lệch; `write` (make contracts)
# xuất lại OpenAPI sau khi đổi route hay model; `token <tệp>` (gọi từ make smoke) kiểm claim
# của một token thật; `config <thành phần> <tệp>` (gọi từ scripts/app-deploy.py) kiểm tệp cấu hình của một thành
# phần theo contracts/<thành phần>.schema.json; `assistant-data <gói | core> <tệp>` (cũng từ app-deploy.py) kiểm mục
# `data` của cấu hình trợ lý với quyền Hasura của chủ sở hữu và chạy câu mẫu qua guard; `package <gói>` chạy mọi bước
# kiểm của một gói, `check` gọi cho từng gói và scripts/app.sh gọi trước khi cài. Các lệnh đó gọi qua đây để
# phiên bản công cụ kiểm chỉ ghim ở tệp này.
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-check}"
checker=(uvx --from check-jsonschema==0.29.4 check-jsonschema)
# Schema danh mục trỏ tới documents.schema.json bằng tên tệp. Không có --base-uri, check-jsonschema ghép tên đó với
# địa chỉ trong $id và đi tải từ mạng (404); với nó, tên tệp trỏ về contracts/ trong repo. Đường dẫn có khoảng trắng
# phải mã hóa thành %20 để còn là URI.
base_uri() { printf -- '--base-uri=file://%s/%s' "${PWD// /%20}" "$1"; }
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

# Kiểm theo schema cho lệnh `package`: lỗi in thành một dòng tiếng Việt chỉ tệp và trường (đường JSONPath), thay cho
# báo cáo tiếng Anh của check-jsonschema, vì người cài gói đọc lỗi này mà không mở schema. Ví dụ sai ở cuối `check`
# vẫn so với lỗi gốc của công cụ (contracts/examples/expected-errors.txt).
schema_check() { # SCHEMA TỆP...
  local schema="$1" report
  shift
  if report=$("${checker[@]}" "$(base_uri "$schema")" --output-format json --schemafile "$schema" "$@"); then
    return 0
  fi
  if ! jq -e .status >/dev/null 2>&1 <<<"$report"; then
    echo "Không chạy được check-jsonschema với $schema (lỗi ở trên); kiểm uv và bộ đệm gói." >&2
    exit 1
  fi
  # Lỗi của oneOf, anyOf chỉ nói "không khớp nhánh nào"; nhánh gần nhất (best_deep_match) mới chỉ đúng trường sai.
  jq -r --arg schema "$schema" '
    (.parse_errors[] | "\(.filename): không đọc được tệp (sai cú pháp YAML hay JSON)"),
    (.errors[] | (.best_deep_match // .) as $e | "\(.filename): trường \($e.path) sai \($schema): \($e.message)")
  ' <<<"$report" >&2
  exit 1
}

# Mọi bước kiểm của một gói, dùng chung cho `check` (make check-fast, từng gói) và bộ cài (scripts/app.sh, trước khi
# đụng CSDL). Không gọi Hasura, CSDL hay mạng: quyền Hasura đọc từ tệp hasura/*.yaml của gói. Tệp cấu hình của mục
# menu (đường `config` trong app.yaml) đọc từ THƯ_MỤC_CẤU_HÌNH, mặc định là thư mục gói; CI đưa cấu hình đã trộn
# ghi đè (#235) qua đúng các bước này bằng cách trỏ nó tới thư mục chứa tệp đã trộn, cùng đường dẫn tương đối như
# trong gói. app.yaml, BPMN, khai báo bước, quyền Hasura, luật, văn bản, dữ liệu demo vẫn đọc từ gói; riêng đối chiếu
# nút danh mục với trường của bước trong check-workflow-steps.py vẫn đọc danh mục của gói.
package_check() { # THƯ_MỤC_GÓI/ THƯ_MỤC_CẤU_HÌNH/
  local app="$1" configs="$2" component entry hasura_dir
  local -a declarations found files hasura
  shopt -s nullglob globstar
  schema_check contracts/app.schema.json "${app}app.yaml"
  # Luật nhiều tệp của app.yaml, trước các bước dưới: tệp thiếu làm chúng dừng bằng traceback.
  "${yaml[@]}" scripts/check-app-manifest.py --app "${app}app.yaml" --configs "$configs"
  declarations=("$app"workflows/*.yaml)
  if ((${#declarations[@]})); then
    schema_check contracts/workflow.schema.json "${declarations[@]}"
  fi
  # Khai báo bước của một gói chỉ đối chiếu với BPMN của chính gói đó.
  "${steps[@]}" --bpmn "$app"**/*.bpmn20.xml --steps "${declarations[@]}" --packages "$app"
  # Mọi quyền phải lọc theo tenant trong token; make check-fast còn kiểm chung mọi tệp quyền của lõi và gói.
  hasura_dir=$("${yaml[@]}" -c '
import sys, yaml
print(yaml.safe_load(open(sys.argv[1], encoding="utf-8")).get("hasura", ""))
' "${app}app.yaml")
  if [[ -n "$hasura_dir" ]]; then
    hasura=("$app$hasura_dir"/*.yaml)
    if ((${#hasura[@]})); then
      "${yaml[@]}" scripts/hasura-metadata.py lint "${hasura[@]}"
    fi
  fi
  # Cấu hình của thành phần có schema nằm ở đường dẫn do app.yaml khai, không theo tên thư mục cố định, nên phải
  # đọc app.yaml để biết tệp nào cần kiểm; dò theo tên thư mục sẽ bỏ sót tệp đặt ở chỗ khác.
  # Khối (`blocks`, ADR 0061) qua cùng bước kiểm như mục menu: cùng dạng, cùng bảng menu_items.
  for component in catalog map assistant form cases dashboard page; do
    mapfile -t found < <("${yaml[@]}" -c '
import os, sys, yaml
app = yaml.safe_load(open(sys.argv[1] + "app.yaml", encoding="utf-8"))
for item in app.get("menu", []) + app.get("blocks", []):
    if item["component"] == sys.argv[2]:
        print(os.path.join(sys.argv[3], item["config"]))
' "$app" "$component" "$configs")
    ((${#found[@]})) || continue
    schema_check "contracts/$component.schema.json" "${found[@]}"
    case "$component" in
      catalog)
        # Nút của danh mục chỉ mở quy trình của chính gói này (ADR 0026), nên đối chiếu với BPMN của gói.
        "${yaml[@]}" scripts/check-catalog-actions.py --bpmn "$app"**/*.bpmn20.xml --catalog "${found[@]}"
        # Phần tài liệu đính kèm đọc và ghi bảng nối của chính gói, trong quyền Hasura của gói (ADR 0041).
        "${yaml[@]}" scripts/check-documents-config.py --app "${app}app.yaml" --configs "$configs"
        ;;
      # Trợ lý dữ liệu chỉ hỏi bảng của chính gói, trong quyền đọc của vai trò user (ADR 0027).
      assistant) "${data_check[@]}" --owner "${app%/}" "${found[@]}" ;;
      # Trang theo dõi hồ sơ chỉ liệt kê quy trình của chính gói này (ADR 0032).
      cases) "${yaml[@]}" scripts/check-cases-config.py --bpmn "$app"**/*.bpmn20.xml --cases "${found[@]}" ;;
      # Bảng điều hành chỉ đọc bảng của chính gói, trong quyền đọc của vai trò từng khối (ADR 0033).
      dashboard) "${yaml[@]}" scripts/check-dashboard-config.py --app "${app}app.yaml" --configs "$configs" ;;
      # Khối của trang là mục của chính gói, không phải trang, kiểu có trong schema của thành phần (ADR 0061).
      page) "${yaml[@]}" scripts/check-page-config.py --app "${app}app.yaml" ;;
    esac
  done
  # Biểu mẫu chỉ gửi tới quy trình hay bảng của chính gói này (ADR 0030), kể cả biểu mẫu khai trong danh mục để sửa
  # dòng, thêm dòng con (ADR 0054). Chạy một lần cho cả hai loại mục menu, ngoài vòng theo thành phần, để gói có cả
  # biểu mẫu lẫn danh mục không bị báo một lỗi hai lần.
  "${yaml[@]}" scripts/check-form-config.py --app "${app}app.yaml" --configs "$configs"
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
      schema_check "contracts/${entry#*:}.schema.json" "${files[@]}"
    fi
  done
  # Dữ liệu demo khai báo: chỉ gói không có bộ nạp riêng (seed/load.py) mới dùng định dạng chung, vì make seed-demo
  # chạy bộ nạp riêng nếu có và bỏ qua demo.yaml của gói đó.
  if [[ -f "${app}seed/demo.yaml" && ! -f "${app}seed/load.py" ]]; then
    schema_check contracts/seed.schema.json "${app}seed/demo.yaml"
  fi
  echo "ok -- gói ${app%/} qua mọi bước kiểm của gói"
}

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
    exec "${checker[@]}" "$(base_uri "contracts/$2.schema.json")" --schemafile "contracts/$2.schema.json" "$3"
    ;;
  assistant-data)
    if [[ -z "${2:-}" || ! -f "${3:-}" ]]; then
      echo "Cách dùng: $0 assistant-data <apps/<gói> | core> <tệp cấu hình trợ lý>." >&2
      exit 2
    fi
    exec "${data_check[@]}" --owner "$2" "$3"
    ;;
  package)
    # Tên gói thành một phần đường dẫn, nên chỉ nhận dạng tên thư mục gói như scripts/app.sh.
    if [[ ! "${2:-}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ || ! -f "apps/${2:-}/app.yaml" ]] ||
      { (($# > 2)) && [[ "$3" != --configs || ! -d "${4:-}" || $# -gt 4 ]]; }; then
      echo "Cách dùng: $0 package <gói có apps/<gói>/app.yaml> [--configs <thư mục cấu hình của mục menu>]." >&2
      exit 2
    fi
    configs="apps/$2/"
    if (($# == 4)); then configs="${4%/}/"; fi
    package_check "apps/$2/" "$configs"
    exit 0
    ;;
  *)
    echo "Cách dùng: $0 [check | write | token <tệp claim> | service-token <tệp claim> | config <thành phần> <tệp> |" \
      "assistant-data <gói | core> <tệp> | package <gói> [--configs <thư mục>]]" >&2
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
"${checker[@]}" "$(base_uri contracts/catalog.schema.json)" --schemafile contracts/catalog.schema.json \
  contracts/examples/catalog.example.yaml
"${checker[@]}" --schemafile contracts/documents.schema.json contracts/examples/documents.example.yaml
"${checker[@]}" --schemafile contracts/map.schema.json contracts/examples/map.example.yaml
"${checker[@]}" --schemafile contracts/form.schema.json contracts/examples/form.example.yaml
"${checker[@]}" --schemafile contracts/cases.schema.json contracts/examples/cases.example.yaml
"${checker[@]}" --schemafile contracts/dashboard.schema.json contracts/examples/dashboard.example.yaml
"${checker[@]}" --schemafile contracts/page.schema.json contracts/examples/page.example.yaml
# Trang mẫu trỏ tới mục và khối của gói mẫu: mục có thật, không phải trang, kiểu có trong schema của thành phần (ADR 0061).
"${yaml[@]}" scripts/check-page-config.py --app contracts/examples/app.example.yaml --examples \
  --page contracts/examples/page.example.yaml
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
# Thương hiệu mặc định trong image cũng là giá trị dự phòng của giao diện (platform/web/src/branding.ts), nên phải
# đúng hợp đồng như ví dụ. Danh sách màu của schema và của giao diện phải trùng: theme.test.ts chỉ kiểm tương phản
# của màu trong BRAND_COLORS, một màu thêm vào schema mà quên ở đó sẽ qua mà chưa ai đo.
"${checker[@]}" --schemafile contracts/branding.schema.json contracts/examples/branding.example.json \
  platform/web/brand/branding.json
schema_colors=$(jq -c '.properties.color.enum' contracts/branding.schema.json)
web_colors=$(sed -n 's/^export const BRAND_COLORS = \(\[.*\]\) as const;$/\1/p' platform/web/src/branding.ts | jq -c .)
if [[ "$schema_colors" != "$web_colors" ]]; then
  echo "Màu của contracts/branding.schema.json ($schema_colors) khác BRAND_COLORS trong platform/web/src/branding.ts" \
    "(${web_colors:-không đọc được})." >&2
  exit 1
fi
"${steps[@]}" --bpmn core/workflow/fixtures/*.bpmn20.xml \
  --steps contracts/examples/workflow.example.yaml core/workflow/fixtures/*.yaml \
  --authorities contracts/examples/authority.example.yaml --rules contracts/examples/threshold-rule.example.yaml
# Gói thật, nếu đã có: mỗi gói qua đúng lệnh `package` mà bộ cài gọi, để hai đường không lệch nhau.
shopt -s nullglob globstar
for manifest in apps/*/app.yaml; do
  name="${manifest#apps/}"
  scripts/contracts.sh package "${name%/app.yaml}"
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

# Ví dụ sai của luật nhiều tệp trong app.yaml (scripts/check-app-manifest.py, bước đầu của lệnh `package`): mỗi thư
# mục trong contracts/examples/invalid-packages/ là một gói tối thiểu phạm đúng một luật, lỗi đúng từng ký tự với
# expected.txt, như ví dụ sai của khai báo bước ở trên. Thư mục mang tên gói, vì luật id trùng tên thư mục xét nó.
cases=(contracts/examples/invalid-packages/*/)
for case in "${cases[@]}"; do
  if result=$("${yaml[@]}" scripts/check-app-manifest.py --app "${case}app.yaml" 2>&1); then
    echo "$case phải bị scripts/check-app-manifest.py từ chối mà lại qua." >&2
    exit 1
  fi
  if [[ "$result" != "$(grep -v '^#' "${case}expected.txt")" ]]; then
    echo "$case phải gây đúng lỗi trong ${case}expected.txt. Đang nhận:" >&2
    echo "$result" >&2
    exit 1
  fi
done
echo "ok -- ${#cases[@]} gói sai bị scripts/check-app-manifest.py từ chối đúng luật"
# Lệnh `package` với --configs (đường CI dùng cho cấu hình đã trộn ghi đè, #235) phải đọc tệp từ thư mục đó và báo
# lỗi schema bằng một dòng tiếng Việt chỉ tệp và trường: chép cấu hình của gói kho rồi làm hỏng tên bảng của danh mục.
overlay=$(mktemp -d)
trap 'rm -rf "$overlay"' EXIT
cp -R apps/supplies-commune/. "$overlay"
sed -i.orig 's/^source: app_supplies_commune_stores$/source: app-supplies-commune-stores/' "$overlay/catalog/stores.yaml"
result=$(scripts/contracts.sh package supplies-commune --configs "$overlay" 2>&1) && result="không bị từ chối"
if [[ "$result" != *"$overlay/catalog/stores.yaml: trường \$.source sai contracts/catalog.schema.json: "* ]]; then
  echo "contracts.sh package --configs phải báo trường source sai trong thư mục cấu hình. Đang nhận: $result" >&2
  exit 1
fi
# Lỗi qua được schema thì do bộ kiểm của thành phần bắt; chúng cũng phải đọc từ thư mục --configs, nếu không cấu
# hình đã trộn bị bỏ qua và bản gốc của gói qua thay nó.
cp apps/supplies-commune/catalog/stores.yaml "$overlay/catalog/stores.yaml"
sed -i.orig 's/{ name: code, label: Mã vật tư/{ name: no_such_column, label: Mã vật tư/' "$overlay/forms/item.yaml"
result=$(scripts/contracts.sh package supplies-commune --configs "$overlay" 2>&1) && result="không bị từ chối"
if [[ "$result" != *"$overlay/forms/item.yaml: vai trò 'tenant_admin' không được ghi cột 'no_such_column' của "* ]]; then
  echo "contracts.sh package --configs phải đưa biểu mẫu trong thư mục cấu hình qua check-form-config.py." \
    "Đang nhận: $result" >&2
  exit 1
fi
echo "ok -- cấu hình hỏng trong thư mục --configs bị lệnh package từ chối, lỗi chỉ tệp và trường"

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
    result=$("${checker[@]}" "$(base_uri "$schema")" --output-format json --schemafile "$schema" "$file" |
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
reject contracts/documents.schema.json contracts/examples/invalid/documents.*.yaml
reject contracts/map.schema.json contracts/examples/invalid/map.*.yaml
reject contracts/form.schema.json contracts/examples/invalid/form.*.yaml
reject contracts/cases.schema.json contracts/examples/invalid/cases.*.yaml
reject contracts/dashboard.schema.json contracts/examples/invalid/dashboard.*.yaml
reject contracts/page.schema.json contracts/examples/invalid/page.*.yaml
reject contracts/assistant.schema.json contracts/examples/invalid/assistant.*.yaml
reject contracts/knowledge.schema.json contracts/examples/invalid/knowledge.*.yaml
reject contracts/threshold-rule.schema.json contracts/examples/invalid/threshold-rule.*.yaml
reject contracts/authority.schema.json contracts/examples/invalid/authority.*.yaml
reject contracts/seed.schema.json contracts/examples/invalid/seed.*.yaml
reject contracts/component.schema.json contracts/examples/invalid/component.*.yaml
reject contracts/device-message.schema.json contracts/examples/invalid/device-message.*.json
reject contracts/branding.schema.json contracts/examples/invalid/branding.*.json
# Các mẫu tên ở trên quyết định tệp nào được kiểm. Tệp đặt sai tên sẽ nằm trong invalid/
# mà chưa từng bị kiểm, nên phải báo lỗi thay vì bỏ qua.
for file in contracts/examples/invalid/*; do
  case "${file##*/}" in
    token-claims.*.json | service-token-claims.*.json | device-message.*.json | app.*.yaml | workflow.*.yaml | catalog.*.yaml | \
    documents.*.yaml | component.*.yaml | branding.*.json | \
    threshold-rule.*.yaml | authority.*.yaml | assistant.*.yaml | knowledge.*.yaml | seed.*.yaml | map.*.yaml | form.*.yaml | \
    cases.*.yaml | dashboard.*.yaml | page.*.yaml) ;;
    *)
      echo "$file không được kiểm: tên phải theo mẫu" \
        "<token-claims|service-token-claims|device-message|branding>.<lỗi>.json hoặc" \
        "<app|workflow|catalog|documents|map|form|cases|dashboard|page|component|threshold-rule|authority|assistant|knowledge|seed>.<lỗi>.yaml." >&2
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
form_rejects "submit.update chỉ dùng cho biểu mẫu mở từ danh mục (detail.edit)" <<'YAML'
title: Sửa
fields: [{ name: code, label: Mã, type: string }]
submit: { label: Lưu, update: app_example_items, version: updated_at }
done: { message: Đã lưu }
YAML
echo "ok -- 7 biểu mẫu và tệp quyền sai bị check-form-config.py từ chối đúng luật"
# Luật của scripts/check-page-config.py (ADR 0061) cũng phải chặn được thật: mỗi trang sai đọc từ stdin, đối chiếu với
# gói mẫu, phạm đúng một luật và lỗi đúng từng ký tự.
page_rejects() { # LỖI_MONG_ĐỢI, trang ở stdin; page_app đặt thì đối chiếu với gói đó thay vì gói mẫu
  local result app=(--app contracts/examples/app.example.yaml --examples)
  [[ -n "${page_app:-}" ]] && app=(--app "$page_app")
  result=$("${yaml[@]}" scripts/check-page-config.py "${app[@]}" --page /dev/stdin 2>&1) &&
    result="không bị từ chối"
  if [[ "$result" != "/dev/stdin: $1" ]]; then
    echo "check-page-config.py phải báo đúng lỗi: $1" >&2
    echo "Đang nhận: $result" >&2
    exit 1
  fi
}
page_rejects "khối 1: không có mục 'nope' trong menu hay blocks của gói" <<'YAML'
title: Tổng quan
blocks: [{ item: nope }]
YAML
page_rejects "khối 1: mục 'overview' là một trang; trang không chứa trang" <<'YAML'
title: Tổng quan
blocks: [{ item: overview }]
YAML
page_rejects "khối 1: catalog không có kiểu 'timeline' (table, cards, kanban, calendar)" <<'YAML'
title: Tổng quan
blocks: [{ item: items, variant: timeline }]
YAML
page_rejects "khối 1: assistant không có kiểu 'compact' (thành phần này chưa có kiểu nào, bỏ variant)" <<'YAML'
title: Tổng quan
blocks: [{ item: ask, variant: compact }]
YAML
# Kiểu Kanban trên danh mục không khai kanban (ADR 0066): danh mục kho vật tư không có trường chia cột.
page_app=apps/supplies-commune/app.yaml \
  page_rejects "khối 1: kiểu 'kanban' cần mục kanban trong cấu hình của 'stores'" <<'YAML'
title: Tổng quan
blocks: [{ item: stores, variant: kanban }]
YAML
echo "ok -- 5 trang sai bị check-page-config.py từ chối đúng luật"
# Biểu mẫu khai trong danh mục (ADR 0054): danh mục mẫu của hợp đồng phải qua với bảng quyền mẫu dưới đây; mỗi danh mục
# sai đọc từ stdin phạm đúng một luật của quyền update hay của cột nối về cha, lỗi đúng từng ký tự.
catalog_form_tables='- table: { schema: app_example, name: items }
  select_permissions:
    - role: user
      permission:
        columns: [id, code, name, status, created_at, updated_at]
        filter: { tenant_id: { _eq: X-Hasura-Tenant-Id } }
  update_permissions:
    - role: user
      permission:
        columns: [code, name, status]
        filter: { tenant_id: { _eq: X-Hasura-Tenant-Id } }
        check: { tenant_id: { _eq: X-Hasura-Tenant-Id } }
- table: { schema: app_example, name: parts }
  insert_permissions:
    - role: user
      permission:
        columns: [item_id, name, installed_on]
        check: { tenant_id: { _eq: X-Hasura-Tenant-Id } }
        set: { tenant_id: X-Hasura-Tenant-Id }'
catalog_forms() { # TỆP_DANH_MỤC
  "${yaml[@]}" scripts/check-form-config.py --app contracts/examples/app.example.yaml \
    --bpmn core/workflow/fixtures/core-approval.bpmn20.xml --steps contracts/examples/workflow.example.yaml \
    --hasura <(printf '%s\n' "${tables:-$catalog_form_tables}") --catalog "$1" 2>&1
}
catalog_forms contracts/examples/catalog.example.yaml
catalog_form_rejects() { # LỖI_MONG_ĐỢI, danh mục ở stdin
  local result
  result=$(catalog_forms /dev/stdin) && result="không bị từ chối"
  if [[ "$result" != "/dev/stdin: $1" ]]; then
    echo "check-form-config.py phải báo đúng lỗi của biểu mẫu trong danh mục: $1" >&2
    echo "Đang nhận: $result" >&2
    exit 1
  fi
}
catalog_form_rejects "nút 'Sửa': vai trò 'user' không được sửa cột 'created_at' của 'app_example_items'" <<'YAML'
title: Danh mục
source: app_example_items
fields: [{ name: name, label: Tên }]
list: { columns: [name] }
detail:
  edit:
    label: Sửa
    form:
      title: Sửa
      fields: [{ name: created_at, label: Ngày tạo, type: date }]
      submit: { label: Lưu, update: app_example_items, version: updated_at }
      done: { message: Đã lưu }
YAML
# Cột version mà người dùng ghi được thì lệnh sửa giữ giá trị cũ, và người sửa sau không được báo.
tables="${catalog_form_tables/columns: \[code, name, status\]/columns: [code, name, status, updated_at]}" \
  catalog_form_rejects "nút 'Sửa': cột 'updated_at' nằm trong quyền update của vai trò 'user'; bỏ khỏi columns" <<'YAML'
title: Danh mục
source: app_example_items
fields: [{ name: name, label: Tên }]
list: { columns: [name] }
detail:
  edit:
    label: Sửa
    form:
      title: Sửa
      fields: [{ name: name, label: Tên, type: string }]
      submit: { label: Lưu, update: app_example_items, version: updated_at }
      done: { message: Đã lưu }
YAML
catalog_form_rejects "nút 'Sửa': vai trò 'user' không đọc được cột 'changed_at' của 'app_example_items'" <<'YAML'
title: Danh mục
source: app_example_items
fields: [{ name: name, label: Tên }]
list: { columns: [name] }
detail:
  edit:
    label: Sửa
    form:
      title: Sửa
      fields: [{ name: name, label: Tên, type: string }]
      submit: { label: Lưu, update: app_example_items, version: changed_at }
      done: { message: Đã lưu }
YAML
catalog_form_rejects "parts: nút 'Thêm': vai trò 'user' không ghi được cột nối về cha 'item_no' của \
'app_example_parts'" <<'YAML'
title: Danh mục
source: app_example_items
fields: [{ name: name, label: Tên }]
list: { columns: [name] }
detail:
  children:
    - id: parts
      label: Thành phần
      via: item_no
      source: app_example_parts
      fields: [{ name: name, label: Tên }]
      list: { columns: [name] }
      add:
        label: Thêm
        form:
          title: Thêm
          fields: [{ name: name, label: Tên, type: string }]
          submit: { label: Thêm, insert: app_example_parts }
          done: { message: Đã thêm }
YAML
catalog_form_rejects "nút 'Sửa': biểu mẫu phải sửa bảng 'app_example_items' (submit.update)" <<'YAML'
title: Danh mục
source: app_example_items
fields: [{ name: name, label: Tên }]
list: { columns: [name] }
detail:
  edit:
    label: Sửa
    form:
      title: Sửa
      fields: [{ name: name, label: Tên, type: string }]
      submit: { label: Lưu, update: app_example_parts, version: updated_at }
      done: { message: Đã lưu }
YAML
# Chuyển thẻ của Kanban ghi cột của trường chia cột (ADR 0066): vai trò không sửa được cột đó thì mọi lần kéo đều bị
# từ chối, nên báo ngay lúc kiểm.
catalog_form_rejects "kanban.move: vai trò 'user' không được sửa cột 'created_at' của 'app_example_items'" <<'YAML'
title: Danh mục
source: app_example_items
fields: [{ name: created_at, label: Ngày tạo, choices: [{ value: a, label: A }] }]
list: { columns: [created_at] }
kanban: { field: created_at, move: { version: updated_at } }
YAML
echo "ok -- 6 danh mục có biểu mẫu sai bị check-form-config.py từ chối đúng luật"
# Luật của scripts/check-documents-config.py, như của biểu mẫu ở trên: danh mục mẫu của hợp đồng phải qua với bảng quyền
# mẫu dưới đây, và mỗi danh mục sai đọc từ stdin phạm đúng một luật, lỗi đúng từng ký tự.
documents_tables='- table: { schema: app_example, name: item_documents }
  select_permissions:
    - role: user
      permission: { columns: [item_id, file_id, note], filter: { tenant_id: { _eq: X-Hasura-Tenant-Id } } }
  insert_permissions:
    - role: user
      permission:
        columns: [item_id, file_id, note]
        check: { tenant_id: { _eq: X-Hasura-Tenant-Id } }
        set: { tenant_id: X-Hasura-Tenant-Id, created_by: X-Hasura-User-Id }'
documents_check() { # TỆP_DANH_MỤC
  "${yaml[@]}" scripts/check-documents-config.py --app contracts/examples/app.example.yaml \
    --hasura <(printf '%s\n' "$documents_tables") --catalog "$1" 2>&1
}
documents_check contracts/examples/catalog.example.yaml
documents_rejects() { # LỖI_MONG_ĐỢI, phần tài liệu ở stdin (lồng vào một danh mục tối thiểu)
  local result
  result=$(documents_check <(printf '%s\n' 'title: Danh mục' 'source: app_example_items' \
    'fields: [{ name: name, label: Tên }]' 'list: { columns: [name] }' 'detail:' '  documents:' && sed 's/^/    /')) &&
    result="không bị từ chối"
  if [[ "$result" != *": phần tài liệu: $1" ]]; then
    echo "check-documents-config.py phải báo đúng lỗi: $1" >&2
    echo "Đang nhận: $result" >&2
    exit 1
  fi
}
documents_rejects "bảng nối 'app_example_files' không có trong quyền Hasura của gói" <<'YAML'
{ title: Giấy tờ, source: app_example_files, via: item_id, file: file_id }
YAML
documents_rejects "vai trò 'user' không đọc được cột 'created_at' của 'app_example_item_documents'" <<'YAML'
title: Giấy tờ
source: app_example_item_documents
via: item_id
file: file_id
fields: [{ name: created_at, label: Ngày, type: datetime }]
YAML
documents_rejects "vai trò 'tenant_admin' không thêm được dòng vào 'app_example_item_documents'; sửa upload.role hoặc \
quyền của gói" <<'YAML'
{ title: Giấy tờ, source: app_example_item_documents, via: item_id, file: file_id, upload: { role: tenant_admin } }
YAML
# Cột tenant làm cột nối: dòng nối luôn mang tenant của người gửi, không phải khóa của dòng đang xem.
documents_rejects "cột 'tenant_id' gắn với tenant của token, không dùng làm via, file hay note" <<'YAML'
{ title: Giấy tờ, source: app_example_item_documents, via: item_id, file: file_id, upload: { note: tenant_id } }
YAML
echo "ok -- 4 phần tài liệu sai bị check-documents-config.py từ chối đúng luật"

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
      permission: { columns: [tenant_id, item_count, score, target, score_percent], filter: { tenant_id: { _eq: X-Hasura-Tenant-Id } } }
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
# Chữ người xem thấy không được mang tên kỹ thuật của cấu hình (ADR 0045): tên bảng ngắn, giá trị của where, khóa
# quy trình, và mọi tên snake_case dù cấu hình không dùng.
dashboard_rejects "khối 't': description có tên kỹ thuật 'totals'; viết bằng lời của người xem, ghi chú kỹ thuật \
đưa vào method" <<'YAML'
title: Tổng quan
panels:
  - id: t
    title: Tổng
    description: Đọc từ totals của gói.
    graphql: { field: app_example_totals }
    cards: [{ column: score, label: Điểm, description: Tổng điểm. }]
YAML
dashboard_rejects "khối 't': title có tên kỹ thuật 'active'; viết bằng lời của người xem, ghi chú kỹ thuật đưa vào \
method" <<'YAML'
title: Tổng quan
panels:
  - id: t
    title: Đối tượng active
    description: Đối tượng đang dùng.
    method: Dòng có tenant_id bằng active.
    graphql: { field: app_example_totals, where: { field: tenant_id, equals: active } }
    cards: [{ column: score, label: Điểm, description: Tổng điểm. }]
YAML
dashboard_rejects "khối 't': cards[0].label có tên kỹ thuật 'score_total'; viết bằng lời của người xem, ghi chú kỹ \
thuật đưa vào method" <<'YAML'
title: Tổng quan
panels:
  - id: t
    title: Tổng
    description: Tổng điểm của đơn vị.
    graphql: { field: app_example_totals }
    cards: [{ column: score, label: Điểm (score_total), description: Tổng điểm. }]
YAML
dashboard_rejects "khối 'c': description có tên kỹ thuật 'core-approval'; viết bằng lời của người xem, ghi chú kỹ \
thuật đưa vào method" <<'YAML'
title: Tổng quan
panels:
  - id: c
    title: Hồ sơ
    description: Hồ sơ của quy trình core-approval.
    role: manager
    workflow: { process: core-approval, counts: tenant }
    cards: [{ column: open, label: Còn mở, description: Hồ sơ còn mở. }]
YAML
# Vòng đo (ADR 0049): số gốc của nó phải là cột của một thẻ, cột phần trăm nằm trong quyền đọc, chữ mức độ của thẻ
# cũng là chữ người xem thấy.
dashboard_rejects "khối 't': gauge.limit 'target' không phải cột của thẻ nào trong khối" <<'YAML'
title: Tổng quan
panels:
  - id: t
    title: Tổng
    description: Điểm so với chỉ tiêu.
    graphql: { field: app_example_totals }
    gauge: { value: score, limit: target, percent: score_percent, label: Điểm so với chỉ tiêu }
    cards: [{ column: score, label: Điểm, description: Tổng điểm. }]
YAML
dashboard_rejects "khối 't': vai trò 'user' không đọc được cột 'ratio' của 'app_example_totals'" <<'YAML'
title: Tổng quan
panels:
  - id: t
    title: Tổng
    description: Điểm so với chỉ tiêu.
    graphql: { field: app_example_totals }
    gauge: { value: score, limit: target, percent: ratio, label: Điểm so với chỉ tiêu }
    cards:
      - { column: score, label: Điểm, description: Tổng điểm. }
      - { column: target, label: Chỉ tiêu, description: Chỉ tiêu. }
YAML
dashboard_rejects "khối 't': cards[0].tone.bad_when.label có tên kỹ thuật 'score'; viết bằng lời của người xem, ghi \
chú kỹ thuật đưa vào method" <<'YAML'
title: Tổng quan
panels:
  - id: t
    title: Tổng
    description: Tổng điểm của đơn vị.
    graphql: { field: app_example_totals }
    cards: [{ column: score, label: Điểm, description: Tổng điểm., tone: { bad_when: { lt: 1, label: score thấp } } }]
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
echo "ok -- 19 bảng điều hành và tệp quyền sai bị check-dashboard-config.py từ chối đúng luật"

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
