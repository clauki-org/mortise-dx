# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Tenant trong chủ đề phải có trong core.tenants trước khi ghi vào Scorpio: Scorpio tạo một CSDL cho mỗi
# tên tenant mới ở lần ghi đầu (ADR 0012), nên tên lạ không được tới đó. Đọc bằng vai trò CSDL iot_bridge,
# chỉ có quyền SELECT trên core.tenants.

import logging
import time
from collections.abc import Callable

import pg8000.native

log = logging.getLogger("iot-bridge.tenants")

# Tenant có thật hiếm khi bị xóa: nhớ lâu. Tenant chưa có thì nhớ ngắn, vì cầu nối chạy trước `make seed`
# tạo tenant và không được bỏ số đo của tenant vừa tạo quá lâu.
KNOWN_SECONDS = 60
UNKNOWN_SECONDS = 5


class TenantCheck:
    def __init__(self, lookup: Callable[[str], bool], clock: Callable[[], float] = time.monotonic):
        self._lookup = lookup
        self._clock = clock
        self._cache: dict[str, tuple[bool, float]] = {}

    def exists(self, tenant: str) -> bool:
        """Tenant có thật không. CSDL lỗi thì coi như không, để không ghi khi chưa kiểm được."""
        now = self._clock()
        cached = self._cache.get(tenant)
        if cached and cached[1] > now:
            return cached[0]
        try:
            found = self._lookup(tenant)
        except Exception as error:  # noqa: BLE001 - mọi lỗi CSDL đều dẫn tới cùng cách xử lý: không ghi
            log.error("Không kiểm được tenant %s trong CSDL: %s", tenant, error)
            return False
        self._cache[tenant] = (found, now + (KNOWN_SECONDS if found else UNKNOWN_SECONDS))
        return found


def database_lookup(host: str, database: str, user: str, password: str) -> Callable[[str], bool]:
    def lookup(tenant: str) -> bool:
        connection = pg8000.native.Connection(
            user, host=host, database=database, password=password, timeout=5
        )
        try:
            return bool(connection.run("SELECT 1 FROM core.tenants WHERE id = :t", t=tenant))
        finally:
            connection.close()

    return lookup
