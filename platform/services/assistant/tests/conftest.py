# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# app.config đọc biến môi trường ngay lúc import và dừng nếu thiếu. Kiểm thử không gọi Keycloak, Hasura hay
# Ollama, nên đặt giá trị giả trước khi pytest import app; tên mô hình đọc từ chính tệp ghim của repo.
# Biến chọn nhà cung cấp bị xóa để kiểm thử luôn chạy với cấu hình mặc định (Ollama), dù shell của người
# chạy có khai API.

import os
from pathlib import Path

for name in ("KEYCLOAK_JWKS_URL", "KEYCLOAK_ISSUER", "ASSISTANT_GRAPHQL_URL", "OLLAMA_URL"):
    os.environ.setdefault(name, "http://unused.invalid")
os.environ.setdefault("ASSISTANT_MODELS_FILE", str(Path(__file__).parents[4] / "core/ollama/models.txt"))
os.environ.setdefault("ASSISTANT_MAX_QUESTION_CHARS", "300")
os.environ.setdefault("ASSISTANT_MIN_SCORE", "0.3")
os.environ.setdefault("ASSISTANT_TOP_PASSAGES", "4")
os.environ.setdefault("ASSISTANT_NUM_PREDICT", "400")
os.environ.setdefault("ASSISTANT_TIMEOUT_SECONDS", "5")
for name in (
    "ASSISTANT_LLM_PROVIDER",
    "ASSISTANT_LLM_BASE_URL",
    "ASSISTANT_LLM_MODEL",
    "ASSISTANT_LLM_API_KEY",
):
    os.environ.pop(name, None)
for name in ("ASSISTANT_DB_HOST", "ASSISTANT_DB_NAME", "ASSISTANT_DB_USER", "ASSISTANT_DB_PASSWORD"):
    os.environ.setdefault(name, "unused")
