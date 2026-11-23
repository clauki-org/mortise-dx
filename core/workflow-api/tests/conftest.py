# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# app.config đọc biến môi trường ngay lúc import và dừng nếu thiếu. Kiểm thử không gọi
# Keycloak, Flowable hay CSDL, nên đặt giá trị giả trước khi pytest import app.

import os

for name in ("KEYCLOAK_JWKS_URL", "KEYCLOAK_ISSUER", "FLOWABLE_URL"):
    os.environ.setdefault(name, "http://unused.invalid")
for name in (
    "FLOWABLE_USER",
    "FLOWABLE_PASSWORD",
    "WORKFLOW_DB_HOST",
    "WORKFLOW_DB_NAME",
    "WORKFLOW_DB_USER",
    "WORKFLOW_DB_PASSWORD",
):
    os.environ.setdefault(name, "unused")
