# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Xuất một đoạn nhật ký thay đổi sang kho lạnh (ADR 0014). Đoạn gồm mọi dòng sau đoạn trước, tới dòng cuối
# cùng cũ hơn mốc thời gian; cắt theo id vì các dòng được ghi lần lượt dưới một khóa (ADR 0009) nên thứ tự id
# là thứ tự của chuỗi, và một dòng đã thấy được thì mọi dòng có id nhỏ hơn đã xong (id bỏ trống do rollback
# không làm đứt chuỗi). Chỉ ghi nhận đoạn sau khi đọc lại tệp vừa ghi, nạp lại vào PostgreSQL và tính lại băm
# từng dòng; dòng nào sai thì không ghi nhận gì. Ghi nhận xong, cùng giao dịch đó xóa các dòng của đoạn khỏi
# core.audit_log bằng core.audit_purge (#97); lỗi ở bất kỳ bước nào thì không ghi nhận, không xóa gì.

import csv
import io
from datetime import datetime

import duckdb
import pg8000.native

from .columns import AT, TEMP_TABLE, live_rows, object_key


class Mismatch(RuntimeError):
    """Tệp vừa ghi không khớp nhật ký trong CSDL; đoạn không được ghi nhận."""


class Busy(RuntimeError):
    """Một lần archive khác đang chạy."""


def as_csv(rows: list[tuple]) -> io.StringIO:
    # QUOTE_NOTNULL: chuỗi rỗng ghi thành "" còn NULL để trống, nên COPY của PostgreSQL phân biệt được hai
    # thứ; nhầm hai thứ này là băm tính lại sai.
    buffer = io.StringIO()
    csv.writer(buffer, quoting=csv.QUOTE_NOTNULL).writerows(rows)
    buffer.seek(0)
    return buffer


def last_segment(pg: pg8000.native.Connection) -> tuple[int, bytes]:
    found = pg.run("SELECT last_id, last_hash FROM core.audit_segments ORDER BY last_id DESC LIMIT 1")
    return (found[0][0], bytes(found[0][1])) if found else (0, b"")


def check(pg: pg8000.native.Connection, first_prev: bytes, first_id: int, last_id: int) -> int:
    """Kiểm bảng tạm cold_rows (nạp từ tệp) so với chuỗi và với CSDL; trả số dòng, sai thì Mismatch."""
    rows = pg.run("SELECT count(*) FROM cold_rows")[0][0]
    expected = pg.run(
        "SELECT count(*) FROM core.audit_log WHERE id BETWEEN :a AND :b", a=first_id, b=last_id
    )[0][0]
    if rows != expected:
        raise Mismatch(f"tệp có {rows} dòng, CSDL có {expected} dòng trong đoạn {first_id}–{last_id}")
    recomputed = pg.run(
        f"SELECT count(*) FROM cold_rows WHERE core.audit_hash(hash_version, prev_hash, id, {AT}, tenant_id, "
        "table_name, op, row_key, before, after, actor, actor_role, db_role) <> hash"
    )[0][0]
    if recomputed:
        raise Mismatch(f"{recomputed} dòng trong tệp tính lại băm không khớp")
    broken = pg.run(
        "SELECT count(*) FROM (SELECT prev_hash, coalesce(lag(hash) OVER (ORDER BY id), :p) AS expected "
        "FROM cold_rows) c WHERE prev_hash <> expected",
        p=first_prev,
    )[0][0]
    if broken:
        raise Mismatch(f"chuỗi băm trong tệp đứt ở {broken} chỗ (so với đoạn trước)")
    differs = pg.run(
        "SELECT count(*) FROM cold_rows c JOIN core.audit_log l USING (id) WHERE l.hash <> c.hash"
    )[0][0]
    if differs:
        raise Mismatch(f"{differs} dòng trong tệp khác dòng cùng id trong CSDL")
    return rows


def archive(
    pg: pg8000.native.Connection, duck: duckdb.DuckDBPyConnection, bucket: str, before: datetime
) -> str:
    # Khóa advisory của phiên: hai lần archive cùng lúc sẽ ghi đè tệp của nhau rồi một lần chết vì ràng buộc
    # của bảng đoạn. Khóa riêng, cùng cách đặt tên với khóa ghi nhật ký của ADR 0009 nhưng khác khóa đó.
    if not pg.run("SELECT pg_try_advisory_lock(hashtext('core.audit_segments'))")[0][0]:
        raise Busy("đang có một lần archive khác chạy; chờ nó xong rồi chạy lại")
    after_id, first_prev = last_segment(pg)
    span = pg.run(
        "SELECT min(id), max(id) FROM core.audit_log WHERE id > :a AND at < :b", a=after_id, b=before
    )[0]
    if span[1] is None:
        return f"Không có dòng nhật ký nào cũ hơn {before.isoformat()} chưa lưu trữ."
    first_id = pg.run("SELECT min(id) FROM core.audit_log WHERE id > :a", a=after_id)[0][0]
    last_id = span[1]
    path = f"s3://{bucket}/{object_key(first_id, last_id)}"

    query = live_rows(after_id, last_id).replace("'", "''")
    duck.execute(f"COPY (SELECT * FROM postgres_query('pg', '{query}')) TO '{path}' (FORMAT parquet)")
    rows = duck.execute(
        "SELECT id, at_us, tenant_id, table_name, op, row_key, before, after, actor, actor_role, db_role, "
        "hash_version, '\\x' || hex(prev_hash), '\\x' || hex(hash) FROM read_parquet(?) ORDER BY id",
        [path],
    ).fetchall()
    file_sha256 = bytes.fromhex(
        duck.execute("SELECT sha256(content) FROM read_blob(?)", [path]).fetchone()[0]
    )

    pg.run("START TRANSACTION")
    try:
        pg.run(TEMP_TABLE)
        pg.run("COPY cold_rows FROM STDIN WITH (FORMAT csv)", stream=as_csv(rows))
        count = check(pg, first_prev, first_id, last_id)
        last_hash = pg.run("SELECT hash FROM cold_rows ORDER BY id DESC LIMIT 1")[0][0]
        segment = pg.run(
            "INSERT INTO core.audit_segments (first_id, last_id, first_prev, last_hash, rows, object_key, "
            "file_sha256) VALUES (:f, :l, :p, :h, :n, :k, :s) RETURNING id",
            f=first_id,
            l=last_id,
            p=first_prev,
            h=last_hash,
            n=count,
            k=object_key(first_id, last_id),
            s=file_sha256,
        )[0][0]
        purged = pg.run("SELECT core.audit_purge(:s)", s=segment)[0][0]
        pg.run("COMMIT")
    except Exception:
        pg.run("ROLLBACK")
        raise
    return (
        f"Đã lưu trữ {count} dòng nhật ký ({first_id}–{last_id}) vào {path}; băm từng dòng khớp; "
        f"đã xóa {purged} dòng khỏi CSDL."
    )
