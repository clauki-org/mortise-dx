# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Dạng một dòng nhật ký trong kho lạnh. Lấy từ chính PostgreSQL: jsonb ở dạng chữ chuẩn (`::text`) và thời
# điểm là số micro giây từ epoch, đúng những gì core.audit_hash băm (ADR 0009), nên nạp lại vào PostgreSQL thì
# tính lại được đúng băm. Lưu `at` kiểu thời gian của Parquet thì múi giờ và độ chính xác tùy công cụ đọc,
# không chắc khớp.

import re

COLUMNS = (
    "id, (extract(epoch FROM at) * 1000000)::bigint AS at_us, tenant_id, table_name, op, "
    "row_key::text AS row_key, before::text AS before, after::text AS after, actor, actor_role, db_role, "
    "hash_version, prev_hash, hash"
)

# Bảng tạm để nạp lại tệp vào PostgreSQL và tính lại băm.
TEMP_TABLE = (
    "CREATE TEMP TABLE cold_rows (id bigint, at_us bigint, tenant_id text, table_name text, op text, "
    "row_key jsonb, before jsonb, after jsonb, actor text, actor_role text, db_role text, "
    "hash_version smallint, prev_hash bytea, hash bytea) ON COMMIT DROP"
)

# Thời điểm từ số micro giây, chính xác tới micro giây (to_timestamp dùng số thực nên có thể lệch).
AT = "'epoch'::timestamptz + at_us * interval '1 microsecond'"


def live_rows(after_id: int, until_id: int | None = None) -> str:
    """Câu lệnh PostgreSQL lấy các dòng nhật ký có id trong (after_id, until_id]."""
    upper = f" AND id <= {int(until_id)}" if until_id is not None else ""
    return f"SELECT {COLUMNS} FROM core.audit_log WHERE id > {int(after_id)}{upper} ORDER BY id"


# Dạng khóa tệp do object_key sinh ra; query.py kiểm lại trước khi ghép vào câu lệnh DuckDB.
OBJECT_KEY = re.compile(r"audit_log/\d{12}-\d{12}\.parquet")


def object_key(first_id: int, last_id: int) -> str:
    return f"audit_log/{int(first_id):012d}-{int(last_id):012d}.parquet"
