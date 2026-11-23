# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Hình dạng yêu cầu và phản hồi của assistant, dùng để sinh contracts/assistant.openapi.json. Đổi model thì
# chạy `make contracts`.

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from .guard import MAX_QUERY_CHARS

_SLUG = r"^[a-z0-9]+(-[a-z0-9]+)*$"


class Question(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(
        description="Câu hỏi; độ dài tối đa do người vận hành đặt (ASSISTANT_MAX_QUESTION_CHARS)"
    )
    app: str = Field(
        pattern=_SLUG, max_length=64, description="Gói sở hữu văn bản, hay `core` cho văn bản mẫu"
    )
    # Mã văn bản cùng dạng với `documents` của cấu hình trợ lý: chỉ chữ thường, số, gạch ngang.
    documents: list[Annotated[str, Field(pattern=_SLUG, max_length=64)]] = Field(
        min_length=1,
        max_length=50,
        description="Mã văn bản được hỏi: `documents` của cấu hình trợ lý (contracts/assistant.schema.json)",
    )


class Citation(BaseModel):
    document_id: str
    title: str = Field(description="Tên văn bản")
    passage_id: str
    label: str = Field(description="Vị trí của đoạn trong văn bản, lấy từ dữ liệu của gói")
    sentence: str = Field(description="Câu nguyên văn trong dữ liệu, không phải chữ của mô hình")


class ModelInfo(BaseModel):
    name: str = Field(description="Tên mô hình mà nhà cung cấp nhận")
    provider: Literal["ollama", "openai-compatible"] = Field(
        description="Cách gọi mô hình, do người vận hành chọn bằng ASSISTANT_LLM_PROVIDER"
    )
    location: Literal["local", "api"] = Field(
        description="local: Ollama trong mạng nội bộ của bản cài; api: câu hỏi và đoạn văn bản gửi tới `host`"
    )
    host: str | None = Field(description="Tên máy của API khi `location` là `api`; null khi chạy tại chỗ")


class Answer(BaseModel):
    outcome: Literal["answered", "refused"]
    answer: str | None = Field(description="Câu trả lời của mô hình; null khi từ chối")
    reason: str | None = Field(description="Lý do từ chối, hiển thị được cho người dùng; null khi trả lời")
    citations: list[Citation] = Field(description="Câu làm căn cứ; rỗng khi từ chối")
    model: ModelInfo | None = Field(
        description="Mô hình đã được hỏi; null khi từ chối mà không gọi mô hình (không có đoạn đủ gần)"
    )


class ErrorBody(BaseModel):
    error: str = Field(description="Lý do bằng tiếng Việt, hiển thị được cho người dùng")


class DataQuery(BaseModel):
    """Câu hỏi dữ liệu (ADR 0027). Bảng, cột được phép không đi theo yêu cầu: dịch vụ đọc từ mục `item`."""

    model_config = ConfigDict(extra="forbid")

    question: str = Field(
        description="Câu hỏi hiện trên màn hình; độ dài tối đa: ASSISTANT_MAX_QUESTION_CHARS"
    )
    app: str = Field(pattern=_SLUG, max_length=64, description="Gói của mục menu, hay `core` cho mục mẫu")
    item: str = Field(
        pattern=_SLUG, max_length=64, description="Mục menu `component: assistant` có khối `data`"
    )
    # Cùng trần với guard: câu dài hơn bị chặn ngay khi đọc thân yêu cầu, không vào nhật ký hay phản hồi.
    query: str = Field(
        max_length=MAX_QUERY_CHARS,
        description="Câu GraphQL chỉ đọc; phải qua guard (bảng, cột, toán tử, limit theo cấu hình của mục)",
    )


class DataColumn(BaseModel):
    key: str = Field(description="Khóa của ô trong mỗi dòng: tên cột, hay <quan hệ>.<cột>")
    label: str = Field(description="Tiêu đề cột lấy từ cấu hình của gói")


Cell = str | int | float | bool | None


class DataTable(BaseModel):
    title: str = Field(description="Tên bảng lấy từ cấu hình của gói")
    columns: list[DataColumn]
    rows: list[dict[str, Cell]] = Field(
        description="Dòng Hasura trả về theo quyền người hỏi, nguyên giá trị; giao diện hiện như chữ thường"
    )


class DataAnswer(BaseModel):
    outcome: Literal["data", "refused"]
    reason: str | None = Field(description="Lý do từ chối, hiển thị được cho người dùng; null khi có dữ liệu")
    query: str = Field(description="Câu truy vấn đã chạy, hay câu bị từ chối; đúng chữ, không sửa")
    tables: list[DataTable] = Field(description="Bảng kết quả; rỗng khi từ chối")
