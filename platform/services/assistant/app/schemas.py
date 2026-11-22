# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Hình dạng yêu cầu và phản hồi của assistant, dùng để sinh contracts/assistant.openapi.json. Đổi model thì
# chạy `make contracts`.

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

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


class Answer(BaseModel):
    outcome: Literal["answered", "refused"]
    answer: str | None = Field(description="Câu trả lời của mô hình; null khi từ chối")
    reason: str | None = Field(description="Lý do từ chối, hiển thị được cho người dùng; null khi trả lời")
    citations: list[Citation] = Field(description="Câu làm căn cứ; rỗng khi từ chối")


class ErrorBody(BaseModel):
    error: str = Field(description="Lý do bằng tiếng Việt, hiển thị được cho người dùng")
