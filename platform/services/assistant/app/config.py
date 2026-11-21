# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Cấu hình đọc từ biến môi trường do compose.yaml truyền vào; thiếu biến thì dừng ngay lúc khởi động thay vì
# lỗi giữa chừng. Tên mô hình lấy từ core/ollama/models.txt (gắn vào container), tệp mà `make ai-up` dùng để
# tải và kiểm digest, để dịch vụ không gọi một mô hình khác với mô hình đã ghim.

import os
from dataclasses import dataclass


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Thiếu biến môi trường {name}; xem compose.yaml.")
    return value


def _number(name: str) -> float:
    value = _required(name)
    try:
        return float(value)
    except ValueError as error:
        raise RuntimeError(f"Biến môi trường {name} phải là số, nhận: {value}.") from error


def _pinned_model(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as file:
            lines = [line.split() for line in file if line.strip() and not line.startswith("#")]
    except OSError as error:
        raise RuntimeError(
            f"Không đọc được {path}; xem volume của dịch vụ assistant trong compose.yaml."
        ) from error
    if not lines:
        raise RuntimeError(f"{path} không có mô hình nào.")
    return lines[0][0]


@dataclass(frozen=True)
class Settings:
    jwks_url: str
    issuer: str
    graphql_url: str
    ollama_url: str
    model: str
    max_question_chars: int
    min_score: float
    top_passages: int
    num_predict: int
    timeout_seconds: float


settings = Settings(
    jwks_url=_required("KEYCLOAK_JWKS_URL"),
    issuer=_required("KEYCLOAK_ISSUER"),
    graphql_url=_required("ASSISTANT_GRAPHQL_URL"),
    ollama_url=_required("OLLAMA_URL"),
    model=_pinned_model(_required("ASSISTANT_MODELS_FILE")),
    max_question_chars=int(_number("ASSISTANT_MAX_QUESTION_CHARS")),
    min_score=_number("ASSISTANT_MIN_SCORE"),
    top_passages=int(_number("ASSISTANT_TOP_PASSAGES")),
    num_predict=int(_number("ASSISTANT_NUM_PREDICT")),
    timeout_seconds=_number("ASSISTANT_TIMEOUT_SECONDS"),
)
