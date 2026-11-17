# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Cấu hình đọc từ biến môi trường do compose.yaml truyền vào; thiếu biến thì dừng ngay.

import os
from dataclasses import dataclass


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Thiếu biến môi trường {name}; xem compose.yaml.")
    return value


@dataclass(frozen=True)
class Settings:
    db_host: str
    db_name: str
    db_user: str
    db_password: str
    s3_endpoint: str
    s3_access_key: str
    s3_secret_key: str
    bucket: str


def load() -> Settings:
    return Settings(
        db_host=_required("COLD_DB_HOST"),
        db_name=_required("COLD_DB_NAME"),
        db_user=_required("COLD_DB_USER"),
        db_password=_required("COLD_DB_PASSWORD"),
        s3_endpoint=_required("COLD_S3_ENDPOINT"),
        s3_access_key=_required("S3_ACCESS_KEY"),
        s3_secret_key=_required("S3_SECRET_KEY"),
        bucket=_required("COLD_BUCKET"),
    )
