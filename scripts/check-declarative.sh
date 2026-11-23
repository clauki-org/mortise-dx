#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm một gói Tầng 3 chỉ gồm tệp khai báo, không có mã chạy (ADR 0022). Gọi từ `make check-fast` với các gói trong
# DECLARATIVE_APPS của Makefile. Mỗi tệp trong apps/<gói>/ phải khớp danh sách được phép: app.yaml và tệp *.yaml
# khác, BPMN (*.bpmn20.xml), tài liệu (*.md), migration (*.sql) chỉ trong thư mục migration mà app.yaml khai. Tệp
# phải là tệp thường, không có bit thực thi hay dòng shebang. Migration không được tạo hàm, thủ tục, trigger, rule
# hay chạy khối DO, và BPMN không được có bước script, bước gọi lớp hay listener: đó là mã chạy trong CSDL hay trong
# Flowable, dù đuôi tệp là khai báo. Riêng tests/ không bị kiểm: bộ cài gói (scripts/app.sh) không đọc thư mục này,
# chỉ CI chạy nó.
set -euo pipefail
cd "$(dirname "$0")/.."

if (($# == 0)); then
  echo "Cách dùng: $0 <gói>... (gói là thư mục trong apps/ có app.yaml)" >&2
  exit 2
fi

py=(uv run --quiet --no-project --with pyyaml==6.0.3 python)
# Bỏ chú thích `--` rồi nối thành một dòng, để lệnh viết xuống dòng giữa CREATE và FUNCTION vẫn bị bắt, còn chữ
# "trigger" trong chú thích tiếng Việt thì không. Chú thích khối /* */ không được bỏ nên có thể báo nhầm; khi đó
# viết chú thích bằng `--`.
# Ranh giới từ viết bằng lớp ký tự thay cho \b, vì grep trên macOS không nhận \b.
create='create[[:space:]]+(or[[:space:]]+replace[[:space:]]+)?((constraint|event)[[:space:]]+)?'
create+='(function|procedure|trigger|rule)([^a-z_]|$)'
block='do[[:space:]]+(\$|'\''|language[^a-z_])'
procedural="(^|[^a-z_])($create|$block)"
# BPMN cũng chở được mã: bước script, bước gọi lớp Java hay biểu thức, và listener. Biểu thức điều kiện trên nhánh
# rẽ (${...}) vẫn được dùng, vì cổng rẽ nhánh cần nó (ADR 0022, Hệ quả). formProperty khai trường của bước (ADR 0031)
# chỉ được có id: thuộc tính expression, variable của nó không mang tiền tố flowable:, và expression là biểu thức
# Flowable chạy. Chỉ bắt được khi thẻ nằm trên một dòng; scripts/workflow_fields.py (cũng trong check-fast) đọc XML
# nên bắt cả thẻ xuống dòng.
bpmn_code='<([A-Za-z]+:)?(scriptTask|serviceTask|sendTask|businessRuleTask|executionListener|taskListener)([^A-Za-z]|$)'
bpmn_code+='|flowable:(class|delegateExpression|expression)='
bpmn_code+='|<([A-Za-z]+:)?formProperty[[:space:]][^>]*(expression|variable)='

errors=0
fail() {
  echo "$1: $2" >&2
  errors=$((errors + 1))
}

for app in "$@"; do
  dir="apps/$app"
  if [[ ! -f "$dir/app.yaml" ]]; then
    fail "$dir" "không có app.yaml; tên trong DECLARATIVE_APPS phải là thư mục gói trong apps/"
    continue
  fi
  migrations=$("${py[@]}" -c '
import sys, yaml
print(yaml.safe_load(open(sys.argv[1], encoding="utf-8"))["database"]["migrations"])
' "$dir/app.yaml")
  while IFS= read -r -d '' file; do
    path="${file#"$dir"/}"
    [[ "$path" == tests/* ]] && continue
    # Liên kết tượng trưng trỏ ra ngoài gói thì nội dung thật không nằm trong gói và không bị kiểm ở đây.
    if [[ -L "$file" || ! -f "$file" ]]; then
      fail "$file" "không phải tệp thường (liên kết tượng trưng hay tệp đặc biệt); gói chỉ chứa tệp thường"
      continue
    fi
    if [[ -x "$file" ]]; then
      fail "$file" "có bit thực thi; gói khai báo không có tệp chạy được"
    fi
    if [[ "$(head -c 2 "$file")" == '#!' ]]; then
      fail "$file" "bắt đầu bằng shebang; gói khai báo không có tệp chạy được"
    fi
    case "$path" in
      *.yaml | *.md) ;;
      *.bpmn20.xml)
        if grep -Eq "$bpmn_code" "$file"; then
          fail "$file" "có bước chạy mã (scriptTask, serviceTask, listener, flowable:class, formProperty có expression hay variable...); chỉ dùng userTask"
        fi
        ;;
      "$migrations"/*.sql)
        if sed 's/--.*$//' "$file" | tr '\n' ' ' | grep -Eiq "$procedural"; then
          fail "$file" "tạo hàm, thủ tục, trigger, rule hay chạy khối DO; gói chỉ được khai bảng, view, ràng buộc"
        fi
        ;;
      *)
        fail "$file" "không thuộc loại tệp được phép (*.yaml, *.bpmn20.xml, *.md, *.sql trong $migrations/)"
        ;;
    esac
  done < <(find "$dir" ! -type d -print0)
done

if ((errors)); then
  echo "Gói trong DECLARATIVE_APPS chỉ được chứa tệp khai báo (docs/adr/0022-declarative-packages.md)." >&2
  exit 1
fi
echo "ok -- $# gói chỉ gồm tệp khai báo"
