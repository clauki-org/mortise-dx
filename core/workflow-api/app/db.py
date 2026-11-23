# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Đọc bảng phân cấp thẩm quyền (core.step_authorities) và quan hệ cha–con (core.tenants) bằng vai trò CSDL
# workflow_api, chỉ có quyền SELECT trên hai bảng đó (ADR 0028). Kết nối mở theo từng lần đọc và chỉ khi cần:
# lúc khởi tạo quy trình có bước đọc bảng, khi xem số hồ sơ của quy trình đó (ADR 0035), và khi người gọi có
# bước của tenant khác giao cho tenant mình (ADR 0029). Nhờ vậy quy trình khác vẫn chạy khi CSDL lỗi, và việc
# nhập module (make contracts, pytest) không cần CSDL.

import logging
from collections.abc import Callable

import pg8000.native
from pg8000.exceptions import DatabaseError, InterfaceError

from .authority import Row
from .config import settings
from .policy import Denied

log = logging.getLogger("workflow-api.db")

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


def _read[T](query: Callable[[pg8000.native.Connection], T], what: str) -> T:
    try:
        connection = pg8000.native.Connection(
            settings.db_user,
            host=settings.db_host,
            database=settings.db_name,
            password=settings.db_password,
            timeout=10,
        )
    except (InterfaceError, DatabaseError) as error:
        log.error("Không kết nối được CSDL để đọc %s: %s", what, error)
        raise Denied(503, f"Không đọc được {what}; báo người vận hành kiểm tra `make ps`.") from error
    try:
        return query(connection)
    except (InterfaceError, DatabaseError) as error:
        log.error("CSDL từ chối đọc %s: %s", what, error)
        raise Denied(
            503,
            f"Không đọc được {what}; báo người vận hành chạy `make up` để áp migration và vai trò "
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
