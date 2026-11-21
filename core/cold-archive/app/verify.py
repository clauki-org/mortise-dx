# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm kho lạnh (make cold-verify, #97): với từng đoạn trong core.audit_segments, đọc lại tệp Parquet, so
# SHA-256 của tệp, nạp vào PostgreSQL và tính lại băm từng dòng bằng chính core.audit_hash, kiểm chuỗi liền
# bên trong đoạn và nối giữa các đoạn. Các dòng đã xóa khỏi CSDL chỉ còn ở đây, nên đây là cách duy nhất kiểm
# lại chúng. Có neo (id:băm ghi trong bản sao lưu) thì tìm dòng đó trong tệp của đoạn chứa nó.

import duckdb
import pg8000.native

from .archive import as_csv
from .columns import AT, OBJECT_KEY, TEMP_TABLE


def segments(pg: pg8000.native.Connection) -> list[tuple]:
    return pg.run(
        "SELECT id, first_id, last_id, first_prev, last_hash, rows, object_key, file_sha256 "
        "FROM core.audit_segments ORDER BY last_id"
    )


def file_rows(duck: duckdb.DuckDBPyConnection, path: str) -> tuple[bytes, list[tuple]]:
    digest = bytes.fromhex(duck.execute("SELECT sha256(content) FROM read_blob(?)", [path]).fetchone()[0])
    rows = duck.execute(
        "SELECT id, at_us, tenant_id, table_name, op, row_key, before, after, actor, actor_role, db_role, "
        "hash_version, '\\x' || hex(prev_hash), '\\x' || hex(hash) FROM read_parquet(?) ORDER BY id",
        [path],
    ).fetchall()
    return digest, rows


def check_segment(pg: pg8000.native.Connection, segment: tuple) -> list[str]:
    """Vấn đề của một đoạn khi so tệp đã nạp (bảng tạm cold_rows) với bản ghi trong core.audit_segments."""
    _, first_id, last_id, first_prev, last_hash, count, _, _ = segment
    problems = []
    found = pg.run("SELECT count(*), min(id), max(id) FROM cold_rows")[0]
    if tuple(found) != (count, first_id, last_id):
        problems.append(
            f"tệp có {found[0]} dòng ({found[1]}–{found[2]}), đoạn ghi {count} dòng ({first_id}–{last_id})"
        )
    recomputed = pg.run(
        f"SELECT count(*) FROM cold_rows WHERE core.audit_hash(hash_version, prev_hash, id, {AT}, tenant_id, "
        "table_name, op, row_key, before, after, actor, actor_role, db_role) <> hash"
    )[0][0]
    if recomputed:
        problems.append(f"{recomputed} dòng tính lại băm không khớp")
    broken = pg.run(
        "SELECT count(*) FROM (SELECT prev_hash, coalesce(lag(hash) OVER (ORDER BY id), :p) AS expected "
        "FROM cold_rows) c WHERE prev_hash <> expected",
        p=bytes(first_prev),
    )[0][0]
    if broken:
        problems.append(f"chuỗi băm trong tệp đứt ở {broken} chỗ")
    last = pg.run("SELECT hash FROM cold_rows ORDER BY id DESC LIMIT 1")
    if not last or bytes(last[0][0]) != bytes(last_hash):
        problems.append("băm dòng cuối trong tệp khác băm cuối ghi trong core.audit_segments")
    return problems


def verify(
    pg: pg8000.native.Connection,
    duck: duckdb.DuckDBPyConnection,
    bucket: str,
    anchor: tuple[int, bytes] | None = None,
) -> tuple[list[str], str]:
    """(vấn đề, tóm tắt). Không có vấn đề nào thì kho lạnh khớp, kể cả neo nếu có."""
    problems: list[str] = []
    previous = b""
    total = 0
    anchor_found = anchor is None
    for segment in segments(pg):
        segment_id, first_id, last_id, first_prev, _, _, key, sha = segment
        label = f"đoạn {segment_id} ({first_id}–{last_id})"
        if not OBJECT_KEY.fullmatch(key):
            problems.append(f"{label}: khóa tệp không đúng dạng")
            continue
        # Đoạn sau phải bắt đầu đúng ở băm cuối của đoạn trước: thiếu hay chèn cả một đoạn thì đứt ở đây.
        if bytes(first_prev) != previous:
            problems.append(f"{label}: không nối vào băm cuối của đoạn trước")
        previous = bytes(segment[4])
        digest, rows = file_rows(duck, f"s3://{bucket}/{key}")
        if digest != bytes(sha):
            problems.append(f"{label}: SHA-256 của tệp khác bản ghi; tệp đã bị thay")
        pg.run("START TRANSACTION")
        try:
            pg.run(TEMP_TABLE)
            pg.run("COPY cold_rows FROM STDIN WITH (FORMAT csv)", stream=as_csv(rows))
            problems += [f"{label}: {problem}" for problem in check_segment(pg, segment)]
            if anchor and first_id <= anchor[0] <= last_id:
                anchor_found = bool(
                    pg.run("SELECT 1 FROM cold_rows WHERE id = :i AND hash = :h", i=anchor[0], h=anchor[1])
                )
        finally:
            pg.run("ROLLBACK")
        total += len(rows)
    if not anchor_found:
        problems.append(
            f"neo {anchor[0]} không khớp dòng nào trong kho lạnh: dòng bị sửa, bị xóa, hay tệp bị thay"
        )
    return problems, f"kho lạnh: {total} dòng trong các đoạn, chuỗi băm khớp"
