#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Đối chiếu bảng core.files với kho tệp (SeaweedFS): mỗi dòng phải có đúng một đối tượng `<tenant>/<id>` và mỗi đối
# tượng phải có dòng trỏ tới. Dòng thiếu đối tượng là tệp tải xuống bị lỗi; đối tượng không có dòng là tệp mồ côi, tốn
# chỗ và không ai thấy. scripts/restore.sh gọi sau khi khôi phục. Chạy trong container files-api để dùng đúng tài
# khoản CSDL và S3 của dịch vụ, không cần mở thêm cổng nào.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose exec -T files-api python - <<'PY'
import sys

import pg8000.native

from app.config import settings
from app.storage import _s3

db = pg8000.native.Connection(
    settings.db_user, host=settings.db_host, database=settings.db_name, password=settings.db_password
)
rows = {f"{tenant}/{file_id}" for tenant, file_id in db.run("SELECT tenant_id, id::text FROM core.files")}
objects = set()
try:
    for page in _s3.get_paginator("list_objects_v2").paginate(Bucket=settings.bucket):
        objects |= {item["Key"] for item in page.get("Contents", [])}
except _s3.exceptions.NoSuchBucket:
    pass  # Chưa tải tệp nào lên thì files-api chưa tạo bucket.
missing, orphans = sorted(rows - objects), sorted(objects - rows)
for key in missing:
    print(f"dòng core.files không có nội dung trong kho tệp: {key}", file=sys.stderr)
for key in orphans:
    print(f"đối tượng trong kho tệp không có dòng core.files: {key}", file=sys.stderr)
if missing or orphans:
    sys.exit(1)
print(f"files: {len(rows)} dòng core.files, mỗi dòng đúng một đối tượng trong kho tệp, không có đối tượng mồ côi")
PY
