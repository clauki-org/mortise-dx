# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Truy vấn gộp kho lạnh và CSDL (ADR 0014): bảng ảo `audit_all` gồm các tệp Parquet của những đoạn đã lưu trữ
# và các dòng còn trong core.audit_log sau đoạn cuối, cùng một dạng cột; cột `source` cho biết dòng đến từ
# đâu. Người vận hành viết SQL của DuckDB trên bảng ảo này; chỉ đọc.

import duckdb
import pg8000.native

from .columns import OBJECT_KEY, live_rows


def define(pg: pg8000.native.Connection, duck: duckdb.DuckDBPyConnection, bucket: str) -> None:
    # Chỉ đọc các tệp đã ghi nhận trong core.audit_segments, không đọc cả thư mục: tệp của một lần xuất bị hủy
    # giữa chừng (kiểm không khớp) vẫn nằm trong bucket và sẽ làm dòng bị đếm hai lần.
    segments = pg.run("SELECT object_key, last_id FROM core.audit_segments ORDER BY last_id")
    last_id = segments[-1][1] if segments else 0
    live = live_rows(last_id).replace("'", "''")
    parts = [f"SELECT *, 'live' AS source FROM postgres_query('pg', '{live}')"]
    if any(not OBJECT_KEY.fullmatch(key) for key, _ in segments):
        raise SystemExit("core.audit_segments có khóa tệp không đúng dạng; không truy vấn.")
    if segments:
        files = ", ".join(f"'s3://{bucket}/{key}'" for key, _ in segments)
        parts.insert(0, f"SELECT *, 'cold' AS source FROM read_parquet([{files}])")
    union = " UNION ALL ".join(parts)
    duck.execute(f"CREATE VIEW audit_all AS SELECT *, make_timestamp(at_us) AS at FROM ({union})")


def run(duck: duckdb.DuckDBPyConnection, sql: str) -> str:
    try:
        return str(duck.sql(sql))
    except duckdb.Error as error:
        raise SystemExit(f"DuckDB không chạy được truy vấn: {error}") from error
