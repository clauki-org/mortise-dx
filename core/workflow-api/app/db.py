# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Đọc bảng phân cấp thẩm quyền (core.step_authorities) và tenant cha (core.tenants) bằng vai trò CSDL
# workflow_api, chỉ có quyền SELECT trên hai bảng đó (ADR 0028). Kết nối mở theo từng lần khởi tạo và chỉ khi
# quy trình có bước đọc bảng, để quy trình khác vẫn chạy khi CSDL lỗi và việc nhập module (make contracts,
# pytest) không cần CSDL.

import logging

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
    try:
        connection = pg8000.native.Connection(
            settings.db_user,
            host=settings.db_host,
            database=settings.db_name,
            password=settings.db_password,
            timeout=10,
        )
    except (InterfaceError, DatabaseError) as error:
        log.error("Không kết nối được CSDL để đọc bảng phân cấp: %s", error)
        raise Denied(
            503, "Không đọc được bảng phân cấp thẩm quyền; báo người vận hành kiểm tra `make ps`."
        ) from error
    try:
        found = connection.run("SELECT parent_id FROM core.tenants WHERE id = :tenant", tenant=tenant)
        rows = connection.run(ROWS, tenant=tenant, process=process, steps=sorted(steps))
    except (InterfaceError, DatabaseError) as error:
        log.error("CSDL từ chối đọc bảng phân cấp: %s", error)
        raise Denied(
            503,
            "Không đọc được bảng phân cấp thẩm quyền; báo người vận hành chạy `make up` để áp migration và "
            "vai trò workflow_api.",
        ) from error
    finally:
        _close(connection)
    by_step: dict[str, list[Row]] = {}
    for step, rule, variable, above, role, scope in rows:
        by_step.setdefault(step, []).append(Row(rule, variable, above, role, scope))
    return (found[0][0] if found else None), by_step


def _close(connection: pg8000.native.Connection) -> None:
    # Lỗi khi đóng không được đè lên kết quả đã đọc xong.
    try:
        connection.close()
    except (InterfaceError, DatabaseError, OSError) as error:
        log.warning("Không đóng được kết nối CSDL: %s", error)
