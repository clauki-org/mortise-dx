# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Cấu hình đọc từ biến môi trường (compose.yaml). Thiếu biến bắt buộc thì dừng ngay
# lúc khởi động thay vì lỗi giữa chừng.

import os
from dataclasses import dataclass


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Thiếu biến môi trường {name}; xem compose.yaml.")
    return value


@dataclass(frozen=True)
class Settings:
    jwks_url: str
    issuer: str
    db_host: str
    db_name: str
    db_user: str
    db_password: str
    s3_url: str
    s3_access_key: str
    s3_secret_key: str
    bucket: str
    max_bytes: int
    clamd_host: str
    clamd_port: int
    scan_timeout: float


settings = Settings(
    jwks_url=_required("KEYCLOAK_JWKS_URL"),
    issuer=_required("KEYCLOAK_ISSUER"),
    db_host=_required("FILES_DB_HOST"),
    db_name=_required("FILES_DB_NAME"),
    db_user=_required("FILES_DB_USER"),
    db_password=_required("FILES_DB_PASSWORD"),
    s3_url=_required("S3_URL"),
    s3_access_key=_required("S3_ACCESS_KEY"),
    s3_secret_key=_required("S3_SECRET_KEY"),
    bucket=_required("FILES_BUCKET"),
    max_bytes=int(_required("FILES_MAX_BYTES")),
    clamd_host=_required("CLAMD_HOST"),
    clamd_port=int(_required("CLAMD_PORT")),
    scan_timeout=float(_required("FILES_SCAN_TIMEOUT")),
)
