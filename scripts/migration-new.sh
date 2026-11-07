#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Tạo tệp migration mới cho lõi, đánh số theo thời điểm UTC (ADR 0005). Tự viết thay vì
# `dbmate new` để tệp có sẵn header SPDX, không thì `make check-fast` báo lỗi giấy phép.
set -euo pipefail
cd "$(dirname "$0")/.."

name="${1:-}"
if [[ ! "$name" =~ ^[a-z0-9_]+$ ]]; then
  echo "Cách dùng: make migrate-new NAME=<ten_ngan> (chữ thường, số, gạch dưới)" >&2
  exit 1
fi

file="core/postgres/migrations/$(date -u +%Y%m%d%H%M%S)_${name}.sql"
cat > "$file" <<'SQL'
-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Vì sao cần thay đổi này. Migration đã áp lên một bản cài thì không sửa nữa: viết
-- migration mới.

-- migrate:up

-- migrate:down
SQL
echo "Đã tạo $file"
