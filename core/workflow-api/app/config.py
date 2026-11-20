# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Cấu hình đọc từ biến môi trường do compose.yaml truyền vào; thiếu biến thì dừng ngay
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
    flowable_url: str
    flowable_user: str
    flowable_password: str
    # Client Keycloak của dịch vụ được mở quy trình thay cho một tenant (ADR 0017). Để trống thì không có
    # dịch vụ nào.
    service_clients: frozenset[str]


settings = Settings(
    jwks_url=_required("KEYCLOAK_JWKS_URL"),
    issuer=_required("KEYCLOAK_ISSUER"),
    flowable_url=_required("FLOWABLE_URL"),
    flowable_user=_required("FLOWABLE_USER"),
    flowable_password=_required("FLOWABLE_PASSWORD"),
    service_clients=frozenset(c for c in os.environ.get("WORKFLOW_SERVICE_CLIENTS", "").split(",") if c),
)
