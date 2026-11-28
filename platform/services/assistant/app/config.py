# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Cấu hình đọc từ biến môi trường do compose.yaml truyền vào; thiếu biến thì dừng ngay lúc khởi động thay vì
# lỗi giữa chừng. Với Ollama, tên mô hình lấy từ core/ollama/models.txt (gắn vào container), tệp mà
# `make ai-up` dùng để tải và kiểm digest, để dịch vụ không gọi một mô hình khác với mô hình đã ghim. Với API
# tương thích OpenAI, tên mô hình là ASSISTANT_LLM_MODEL. Các biến ASSISTANT_LLM_* không bắt buộc ở đây:
# khai thiếu thì providers.py báo 503 kèm cách sửa, vì dừng dịch vụ lúc khởi động sẽ kéo theo cả cổng APISIX
# đang chờ nó.

import os
from dataclasses import dataclass, field
from urllib.parse import urlsplit


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


def _log_level(name: str) -> str:
    # Không bắt buộc: mặc định INFO (một dòng mỗi lời gọi mô hình, không kèm nội dung). DEBUG thêm lý do mô
    # hình tự ghi khi viết câu truy vấn, chỉ để người vận hành gỡ lỗi.
    value = (os.environ.get(name) or "INFO").upper()
    if value not in ("DEBUG", "INFO", "WARNING", "ERROR"):
        raise RuntimeError(f"Biến môi trường {name} chỉ nhận DEBUG, INFO, WARNING, ERROR; nhận: {value}.")
    return value


# compose.yaml truyền chuỗi rỗng cho biến không có trong .env, nên rỗng cũng là chưa khai.
_PROVIDER = os.environ.get("ASSISTANT_LLM_PROVIDER") or "ollama"
_BASE_URL = os.environ.get("ASSISTANT_LLM_BASE_URL", "")


def _host(url: str) -> str | None:
    # Địa chỉ sai dạng không dừng dịch vụ: tên máy là None và providers.py báo 503 chỉ biến cần sửa.
    try:
        return urlsplit(url).hostname
    except ValueError:
        return None


@dataclass(frozen=True)
class Settings:
    jwks_url: str
    issuer: str
    graphql_url: str
    ollama_url: str
    # Tên ghi trong .env, providers.py kiểm giá trị: chỉ nhận `ollama` và `openai-compatible`.
    llm_provider: str
    llm_base_url: str
    # Chỉ tên máy của API, không cả địa chỉ: tên này hiện cho người hỏi và vào nhật ký câu hỏi.
    llm_host: str | None
    # Mô hình được gọi: bản ghim của Ollama, hay ASSISTANT_LLM_MODEL khi gọi qua API.
    model: str
    # repr=False: in cấu hình ra log khi gỡ lỗi không được làm lộ khóa.
    llm_api_key: str = field(repr=False)
    max_question_chars: int
    min_score: float
    top_passages: int
    num_predict: int
    # Trần token sinh cho bản nháp cấu hình gói (ADR 0071): bản nháp gồm nhiều tệp, dài hơn hẳn câu trả lời.
    draft_num_predict: int
    # Cửa sổ ngữ cảnh của Ollama cho bản nháp: prompt gồm tài liệu, bản mô tả và ví dụ của mọi thành phần.
    draft_num_ctx: int
    timeout_seconds: float
    db_host: str
    db_name: str
    db_user: str
    db_password: str
    log_level: str
    # Thư mục contracts/ gắn chỉ đọc (compose.yaml): bản mô tả, ví dụ và schema để soạn và kiểm bản nháp.
    contracts_dir: str
    # docs/packages.md gắn chỉ đọc: tài liệu nền tảng về cách các tệp của một gói nối với nhau, vào prompt.
    package_guide: str


settings = Settings(
    jwks_url=_required("KEYCLOAK_JWKS_URL"),
    issuer=_required("KEYCLOAK_ISSUER"),
    graphql_url=_required("ASSISTANT_GRAPHQL_URL"),
    ollama_url=_required("OLLAMA_URL"),
    llm_provider=_PROVIDER,
    llm_base_url=_BASE_URL,
    llm_host=_host(_BASE_URL) if _PROVIDER != "ollama" else None,
    model=(
        _pinned_model(_required("ASSISTANT_MODELS_FILE"))
        if _PROVIDER == "ollama"
        else os.environ.get("ASSISTANT_LLM_MODEL", "")
    ),
    llm_api_key=os.environ.get("ASSISTANT_LLM_API_KEY", ""),
    max_question_chars=int(_number("ASSISTANT_MAX_QUESTION_CHARS")),
    min_score=_number("ASSISTANT_MIN_SCORE"),
    top_passages=int(_number("ASSISTANT_TOP_PASSAGES")),
    num_predict=int(_number("ASSISTANT_NUM_PREDICT")),
    draft_num_predict=int(_number("ASSISTANT_DRAFT_NUM_PREDICT")),
    draft_num_ctx=int(_number("ASSISTANT_DRAFT_NUM_CTX")),
    timeout_seconds=_number("ASSISTANT_TIMEOUT_SECONDS"),
    db_host=_required("ASSISTANT_DB_HOST"),
    db_name=_required("ASSISTANT_DB_NAME"),
    db_user=_required("ASSISTANT_DB_USER"),
    db_password=_required("ASSISTANT_DB_PASSWORD"),
    log_level=_log_level("ASSISTANT_LOG_LEVEL"),
    contracts_dir=_required("ASSISTANT_CONTRACTS_DIR"),
    package_guide=_required("ASSISTANT_PACKAGE_GUIDE"),
)
