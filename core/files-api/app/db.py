# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Thông tin tệp trong bảng core.files, bằng vai trò CSDL files_api: vai trò này chỉ đọc và
# thêm được dòng của bảng đó, nên dịch vụ có bị chiếm cũng không chạm tới dữ liệu khác.
# Mọi truy vấn lọc theo tenant của người gọi.

import logging

import pg8000.native
from pg8000.exceptions import DatabaseError, InterfaceError

from .config import settings
from .policy import Denied

log = logging.getLogger("files-api.db")
# Mã lỗi PostgreSQL khi vi phạm khóa ngoại: tenant trong token chưa có trong core.tenants.
FOREIGN_KEY_VIOLATION = "23503"

FIELDS = ("id", "name", "contentType", "size", "sha256", "uploadedBy", "status", "created")


def _connect() -> pg8000.native.Connection:
    try:
        return pg8000.native.Connection(
            settings.db_user,
            host=settings.db_host,
            database=settings.db_name,
            password=settings.db_password,
            timeout=10,
        )
    except (InterfaceError, DatabaseError) as error:
        log.error("Không kết nối được CSDL: %s", error)
        raise Denied(
            503, "Không kết nối được CSDL; báo người vận hành kiểm tra dịch vụ postgres (`make ps`)."
        ) from error


def _run(sql: str, actor: str | None = None, **params) -> list[list]:
    connection = _connect()
    try:
        if actor is None:
            return connection.run(sql, **params)
        # Nhật ký thay đổi (core.audit_row) đọc người làm từ mortise.actor. set_config(..., true) chỉ sống
        # trong giao dịch hiện tại, mà pg8000 tự commit từng câu, nên mở giao dịch tường minh. Lỗi giữa chừng
        # thì đóng kết nối, giao dịch tự hủy.
        connection.run("BEGIN")
        connection.run("SELECT set_config('mortise.actor', :actor, true)", actor=actor)
        rows = connection.run(sql, **params)
        connection.run("COMMIT")
        return rows
    except InterfaceError as error:
        # Mất kết nối giữa giao dịch: giao dịch tự hủy, không ghi nửa chừng.
        log.error("Mất kết nối CSDL giữa chừng: %s", error)
        raise Denied(503, "Mất kết nối CSDL; thử lại sau ít phút, nếu vẫn lỗi báo người vận hành.") from error
    except DatabaseError as error:
        details = error.args[0] if error.args and isinstance(error.args[0], dict) else {}
        if details.get("C") == FOREIGN_KEY_VIOLATION:
            raise Denied(
                403, "Đơn vị của tài khoản chưa được khai báo trong hệ thống; báo người quản trị."
            ) from error
        log.error("CSDL từ chối truy vấn: %s", error)
        raise Denied(503, "CSDL từ chối ghi hay đọc thông tin tệp; báo người vận hành.") from error
    finally:
        connection.close()


def _as_dict(row: list) -> dict:
    record = dict(zip(FIELDS, row, strict=True))
    record["created"] = record["created"].isoformat()
    return record


def insert(record: dict) -> dict:
    rows = _run(
        # Chỉ gọi sau khi tệp đã quét sạch (main.upload), nên ghi thẳng `clean`.
        "INSERT INTO core.files (id, tenant_id, name, content_type, size, sha256, uploaded_by, status) "
        "VALUES (CAST(:id AS uuid), :tenant, :name, :content_type, :size, :sha256, :uploaded_by, 'clean') "
        "RETURNING id::text, name, content_type, size, sha256, uploaded_by, status, created_at",
        actor=record["uploaded_by"],
        **record,
    )
    return _as_dict(rows[0])


def find(tenant: str, file_id: str) -> dict | None:
    rows = _run(
        "SELECT id::text, name, content_type, size, sha256, uploaded_by, status, created_at "
        "FROM core.files WHERE id = CAST(:id AS uuid) AND tenant_id = :tenant",
        id=file_id,
        tenant=tenant,
    )
    return _as_dict(rows[0]) if rows else None
