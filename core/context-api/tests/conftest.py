# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# app.config đọc biến môi trường ngay lúc import và dừng nếu thiếu. Kiểm thử không gọi
# Keycloak hay Scorpio, nên đặt giá trị giả trước khi pytest import app.

import os

for name in ("KEYCLOAK_JWKS_URL", "KEYCLOAK_ISSUER", "SCORPIO_URL"):
    os.environ.setdefault(name, "http://unused.invalid")
