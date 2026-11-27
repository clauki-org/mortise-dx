# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Đọc bảng phân cấp thẩm quyền (core.step_authorities) và quan hệ cha–con (core.tenants) bằng vai trò CSDL
# workflow_api, chỉ có quyền SELECT trên hai bảng đó (ADR 0028); thêm dòng niêm phong (core.case_seals) và hạn
# của bước chờ (core.case_deadlines), hai bảng chỉ thêm (ADR 0053). Kết nối mở theo từng lần dùng và chỉ khi
# cần: lúc khởi tạo quy trình có bước đọc bảng, khi xem số hồ sơ của quy trình đó (ADR 0035), khi người gọi có
# bước của tenant khác giao cho tenant mình (ADR 0029), và với quy trình khai niêm phong hay có bước chờ. Nhờ
# vậy quy trình khác vẫn chạy khi CSDL lỗi, và việc nhập module (make contracts, pytest) không cần CSDL.

import logging
from collections.abc import Callable

import pg8000.native
from opentelemetry import trace
from pg8000.exceptions import DatabaseError, InterfaceError

from .authority import Row
from .config import settings
from .policy import Denied

log = logging.getLogger("workflow-api.db")
# pg8000.native không có instrumentation của OpenTelemetry: span tự viết quanh mỗi lần đọc để vết thấy thời
# gian ở CSDL (ADR 0038). Chỉ ghi loại câu, không ghi câu SQL hay tham số (tenant, quy trình). Tắt truy
# vết thì span không làm gì.
_tracer = trace.get_tracer(__name__)

ROWS = """
SELECT step, rule, variable, above::float8, role, scope FROM core.step_authorities
WHERE tenant_id = :tenant AND process = :process AND step = ANY(CAST(:steps AS text[]))
"""


def authorities(tenant: str, process: str, steps: frozenset[str]) -> tuple[str | None, dict[str, list[Row]]]:
    """Tenant cha của `tenant` (None nếu không có) và các dòng của từng bước trong `steps`."""

    def read(connection: pg8000.native.Connection) -> tuple[list, list]:
        found = connection.run("SELECT parent_id FROM core.tenants WHERE id = :tenant", tenant=tenant)
        return found, connection.run(ROWS, tenant=tenant, process=process, steps=sorted(steps))

    found, rows = _read(read, "bảng phân cấp thẩm quyền")
    by_step: dict[str, list[Row]] = {}
    for step, rule, variable, above, role, scope in rows:
        by_step.setdefault(step, []).append(Row(rule, variable, above, role, scope))
    return (found[0][0] if found else None), by_step


def authority_roles(tenant: str, process: str) -> frozenset[str]:
    """Vai trò trong các dòng cấp tenant của bảng phân cấp cho quy trình `process` của `tenant` (ADR 0035).

    Bỏ dòng scope parent: vai trò của dòng đó là của người ở tenant cha, người trong tenant có cùng tên vai
    trò không làm bước nào của quy trình.
    """
    query = (
        "SELECT DISTINCT role FROM core.step_authorities "
        "WHERE tenant_id = :tenant AND process = :process AND scope = 'tenant'"
    )
    rows = _read(lambda c: c.run(query, tenant=tenant, process=process), "bảng phân cấp thẩm quyền")
    return frozenset(row[0] for row in rows)


def children(tenant: str) -> frozenset[str]:
    """Tenant con trực tiếp của `tenant` lúc này (ADR 0029). Đọc mỗi lần chứ không nhớ: người vận hành đổi
    parent_id thì tenant cha cũ phải mất quyền với bước của tenant con ngay."""
    rows = _read(
        lambda c: c.run("SELECT id FROM core.tenants WHERE parent_id = :tenant", tenant=tenant), "tenant con"
    )
    return frozenset(row[0] for row in rows)


SEAL = "SELECT encode(hash, 'hex'), sealed_at, hash_version FROM core.case_seals WHERE case_id = :case"

INSERT_SEAL = """
INSERT INTO core.case_seals (case_id, tenant_id, process, hash_version, hash)
VALUES (:case, :tenant, :process, :version, decode(:hash, 'hex'))
ON CONFLICT (case_id) DO NOTHING
"""

INSERT_DEADLINE = """
INSERT INTO core.case_deadlines (case_id, tenant_id, process, activity_id, due_at)
VALUES (:case, :tenant, :process, :activity, CAST(:due AS timestamptz))
ON CONFLICT DO NOTHING
"""


def seal(case: str) -> dict | None:
    """Dòng niêm phong của hồ sơ `case`, hay None nếu chưa có. Người gọi đã kiểm hồ sơ thuộc tenant."""
    rows = _read(lambda c: c.run(SEAL, case=case), "trạng thái niêm phong")
    if not rows:
        return None
    digest, sealed_at, version = rows[0]
    return {"hash": digest, "sealed_at": sealed_at.isoformat(), "version": version}


def seals() -> list[tuple[str, str, str, int, str]]:
    """Mọi dòng niêm phong (hồ sơ, tenant, quy trình, phiên bản, băm hex), cho `make seal-verify`."""
    query = (
        "SELECT case_id, tenant_id, process, hash_version, encode(hash, 'hex') FROM core.case_seals "
        "ORDER BY sealed_at, case_id"
    )
    return [tuple(row) for row in _read(lambda c: c.run(query), "bảng niêm phong")]


def insert_seal(case: str, tenant: str, process: str, version: int, digest: str, actor: str | None) -> None:
    """Thêm dòng niêm phong; hồ sơ đã có dòng thì giữ dòng cũ (bảng chỉ thêm, hai đường niêm phong có thể chạy
    cùng lúc)."""
    params = {"case": case, "tenant": tenant, "process": process, "version": version, "hash": digest}
    _write([(INSERT_SEAL, params)], actor, "dòng niêm phong")


def insert_deadlines(rows: list[dict[str, str]]) -> None:
    """Thêm hạn của bước chờ (case, tenant, process, activity, due); dòng đã có thì bỏ qua."""
    _write([(INSERT_DEADLINE, row) for row in rows], None, "hạn của bước chờ")


@_tracer.start_as_current_span(
    "postgres INSERT",
    kind=trace.SpanKind.CLIENT,
    attributes={"db.system.name": "postgresql", "db.operation.name": "INSERT"},
    record_exception=False,
)
def _write(statements: list[tuple[str, dict]], actor: str | None, what: str) -> None:
    def write(connection: pg8000.native.Connection) -> None:
        # Nhật ký thay đổi (core.audit_row) đọc người làm từ mortise.actor; set_config(..., true) chỉ sống
        # trong giao dịch hiện tại, mà pg8000 tự commit từng câu, nên mở giao dịch tường minh như files-api.
        # Lỗi giữa chừng thì đóng kết nối, giao dịch tự hủy, không ghi nửa chừng.
        connection.run("BEGIN")
        if actor is not None:
            connection.run("SELECT set_config('mortise.actor', :actor, true)", actor=actor)
        for sql, params in statements:
            connection.run(sql, **params)
        connection.run("COMMIT")

    _use(write, "ghi", what)


@_tracer.start_as_current_span(
    "postgres SELECT",
    kind=trace.SpanKind.CLIENT,
    attributes={"db.system.name": "postgresql", "db.operation.name": "SELECT"},
    record_exception=False,
)
def _read[T](query: Callable[[pg8000.native.Connection], T], what: str) -> T:
    return _use(query, "đọc", what)


def _use[T](query: Callable[[pg8000.native.Connection], T], verb: str, what: str) -> T:
    try:
        connection = pg8000.native.Connection(
            settings.db_user,
            host=settings.db_host,
            database=settings.db_name,
            password=settings.db_password,
            timeout=10,
        )
    except (InterfaceError, DatabaseError) as error:
        log.error("Không kết nối được CSDL để %s %s: %s", verb, what, error)
        raise Denied(503, f"Không {verb} được {what}; báo người vận hành kiểm tra `make ps`.") from error
    try:
        return query(connection)
    except (InterfaceError, DatabaseError) as error:
        log.error("CSDL từ chối %s %s: %s", verb, what, error)
        raise Denied(
            503,
            f"Không {verb} được {what}; báo người vận hành chạy `make up` để áp migration và vai trò "
            "workflow_api.",
        ) from error
    finally:
        _close(connection)


def _close(connection: pg8000.native.Connection) -> None:
    # Lỗi khi đóng không được đè lên kết quả đã đọc xong.
    try:
        connection.close()
    except (InterfaceError, DatabaseError, OSError) as error:
        log.warning("Không đóng được kết nối CSDL: %s", error)
