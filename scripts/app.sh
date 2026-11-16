#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Cài, gỡ và xem trạng thái một gói Tầng 3 trên lõi đang chạy. Đọc apps/<gói>/app.yaml
# (contracts/app.schema.json) để biết lược đồ, thư mục migration và thư mục metadata Hasura.
# Migration chạy bằng dbmate với thư mục và bảng theo dõi riêng của gói (ADR 0005); metadata
# Hasura áp bằng scripts/hasura-metadata.py như bảng của lõi. Cài: migrate rồi áp metadata. Gỡ:
# bỏ đăng ký metadata rồi mới lùi migration, để Hasura không trỏ tới bảng đã xóa. Chạy lại
# nhiều lần không lỗi. Chưa deploy quy trình và menu của gói; lệnh cài gói đầy đủ thuộc Sprint 2 (#58).
set -euo pipefail
cd "$(dirname "$0")/.."
# .env do `make env` sinh ra và không có trong repo, nên shellcheck không đọc theo.
set -a
# shellcheck source=/dev/null
source .env
set +a

app="${1:-}"
action="${2:-}"
manifest="apps/$app/app.yaml"
if [[ -z "$app" || ! -f "$manifest" || ! "$action" =~ ^(install|uninstall|status)$ ]]; then
  echo "Cách dùng: scripts/app.sh <gói> install|uninstall|status (gói là thư mục trong apps/ có app.yaml)" >&2
  exit 1
fi

py=(uv run --quiet --no-project --with pyyaml==6.0.3 python)
# Ba dòng: lược đồ, thư mục migration, thư mục Hasura; app.yaml đã được kiểm theo schema ở `make check-fast`.
{ read -r schema; read -r migrations; read -r hasura_dir; } < <("${py[@]}" -c '
import sys, yaml
app = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
print(app["database"]["schema"]); print(app["database"]["migrations"]); print(app.get("hasura", ""))
' "$manifest")
# Bảng theo dõi nằm ngoài lược đồ của gói (ADR 0005). Tên gói dùng gạch nối, tên bảng không.
table="public.${app//-/_}_schema_migrations"
declarations=()
if [[ -n "$hasura_dir" ]]; then declarations=("apps/$app/$hasura_dir"/*.yaml); fi

# Dùng lại dịch vụ `migrate` của compose (cùng image, cùng DATABASE_URL), chỉ đổi thư mục và
# bảng theo dõi. Mount vào đường dẫn khác vì /migrations đã bị chiếm bởi migration của lõi.
dbmate() {
  docker compose run --rm --no-deps -T \
    -v "$PWD/apps/$app/$migrations:/app-migrations:ro" \
    -e DBMATE_MIGRATIONS_DIR=/app-migrations -e "DBMATE_MIGRATIONS_TABLE=$table" \
    migrate --wait --no-dump-schema --migration-lock "$@"
}

metadata() { "${py[@]}" scripts/hasura-metadata.py "$1" "${declarations[@]}"; }

applied() { dbmate status 2>/dev/null | awk '/^Applied:/ {print $2}'; }

case "$action" in
  status)
    dbmate status
    ;;
  install)
    dbmate up --strict
    if ((${#declarations[@]})); then metadata apply; fi
    echo "Gói $app đã cài (lược đồ $schema). Kiểm: apps/$app/tests/smoke.sh"
    ;;
  uninstall)
    if ((${#declarations[@]})); then metadata untrack; fi
    # dbmate rollback lùi một migration mỗi lần (ADR 0005), nên lặp tới khi gói không còn gì.
    while [[ "$(applied)" != "0" ]]; do dbmate rollback; done
    echo "Gói $app đã gỡ. Kiểm lõi còn chạy: make smoke"
    ;;
esac
