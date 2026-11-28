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


class DataQuestion(BaseModel):
    """Câu hỏi dữ liệu gõ tự do (ADR 0034): mô hình viết câu truy vấn, câu qua cùng guard như `DataQuery`."""

    model_config = ConfigDict(extra="forbid")

    question: str = Field(
        description="Câu hỏi người dùng gõ; độ dài tối đa: ASSISTANT_MAX_QUESTION_CHARS. Không gửi bảng "
        "hay câu truy vấn: dịch vụ đọc bảng, cột được phép từ mục `item` và mô hình viết câu."
    )
    app: str = Field(pattern=_SLUG, max_length=64, description="Gói của mục menu, hay `core` cho mục mẫu")
    item: str = Field(
        pattern=_SLUG, max_length=64, description="Mục menu `component: assistant` có khối `data`"
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
    """Kết quả của cả câu mẫu (`/data-queries`) và câu hỏi gõ tự do (`/data-questions`)."""

    # Ba trường của câu hỏi gõ tự do có mặc định null cho câu mẫu, nhưng phản hồi luôn mang chúng: OpenAPI ghi
    # là bắt buộc để giao diện không phải đoán trường vắng hay null.
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    outcome: Literal["data", "refused"]
    reason: str | None = Field(description="Lý do từ chối, hiển thị được cho người dùng; null khi có dữ liệu")
    query: str = Field(
        description="Câu truy vấn đã chạy, hay câu bị từ chối; đúng chữ, không sửa. Chuỗi rỗng khi mô hình "
        "không viết câu nào (`refused_by` là `model`)"
    )
    tables: list[DataTable] = Field(description="Bảng kết quả; rỗng khi từ chối")
    model: ModelInfo | None = Field(
        default=None, description="Mô hình đã viết câu truy vấn; null với câu mẫu (không qua mô hình)"
    )
    attempts: int | None = Field(
        default=None,
        description="Số lượt mô hình viết câu: 1, hay 2 khi guard từ chối câu đầu và mô hình viết lại; null "
        "với câu mẫu",
    )
    refused_by: Literal["model", "guard", "hasura"] | None = Field(
        default=None,
        description="Bước đã từ chối câu hỏi gõ tự do: mô hình nói không trả lời được, guard chặn câu mô "
        "hình viết, hay Hasura từ chối câu đã qua guard; null khi có dữ liệu và với câu mẫu",
    )


class DraftRequest(BaseModel):
    """Nhu cầu cần soạn bản nháp cấu hình gói (ADR 0071)."""

    model_config = ConfigDict(extra="forbid")

    need: str = Field(
        description="Nhu cầu người dựng hệ thống gõ: gói cần những màn hình nào, quản lý gì; độ dài tối đa: "
        "ASSISTANT_MAX_QUESTION_CHARS"
    )


class DraftFile(BaseModel):
    path: str = Field(description="Đường dẫn tương đối trong thư mục gói apps/<gói>/")
    component: str | None = Field(
        description="Thành phần mà mục menu trỏ tới tệp này khai trong app.yaml; null với app.yaml, tệp "
        "không mục nào trỏ tới, và tệp của mục khai thành phần chưa có bản mô tả"
    )
    content: str = Field(description="Nội dung YAML do mô hình viết, đúng chữ, không sửa")


class DraftProblem(BaseModel):
    path: str = Field(description="Tệp có lỗi")
    message: str = Field(description="Lỗi khi kiểm theo contracts/, như `make check-fast` báo")


class DraftArgument(BaseModel):
    need: str = Field(description="Đoạn của nhu cầu mà lập luận dựa vào; dịch vụ đã kiểm có trong nhu cầu")
    capability: str = Field(
        description="Câu nguyên văn trong contracts/<thành phần>.component.yaml mô tả công dụng đáp ứng đoạn "
        "đó; dịch vụ chép theo mã mô hình chỉ ra"
    )
    why: str = Field(description="Câu mô hình viết nối đoạn nhu cầu với công dụng; không qua bước kiểm nào")


class DraftChoice(BaseModel):
    item: str = Field(description="id của mục menu hay khối trong app.yaml")
    component: str = Field(description="Thành phần mục đó dùng, đọc từ app.yaml")
    arguments: list[DraftArgument] = Field(
        description="Tối đa ba lập luận vì sao thành phần hợp với nhu cầu; lập luận có đoạn nhu cầu không "
        "có trong nhu cầu hay mã câu không có trong bản mô tả bị bỏ"
    )


class PackageDraft(BaseModel):
    """Bản nháp app.yaml và cấu hình của các mục menu, khối. Không có migration, quyền Hasura, BPMN hay văn
    bản, nên chưa cài được ngay; dịch vụ không ghi gì vào apps/, chỉ ghi một dòng nhật ký."""

    outcome: Literal["drafted", "invalid", "refused"] = Field(
        description="drafted: mọi tệp qua bước kiểm; invalid: còn lỗi, xem `problems` và `reason`; "
        "refused: mô hình nói không soạn được bằng các thành phần hiện có"
    )
    reason: str | None = Field(description="Lý do khi invalid hay refused, hiển thị được; null khi drafted")
    files: list[DraftFile] = Field(description="Các tệp của bản nháp; rỗng khi refused")
    problems: list[DraftProblem] = Field(description="Lỗi còn lại khi kiểm; rỗng khi drafted")
    to_write: list[DraftProblem] = Field(
        description="Tệp app.yaml khai (quy trình, luật, văn bản, bảng thẩm quyền) mà bản nháp không có; "
        "viết trước khi cài. Không làm bản nháp thành invalid"
    )
    choices: list[DraftChoice] = Field(description="Lý do chọn thành phần của từng mục menu hay khối")
    model: ModelInfo | None = Field(description="Mô hình đã soạn bản nháp")
    attempts: int = Field(description="Số lượt mô hình đã trả bản nháp: 1, hay 2 khi có lượt sửa trả về")
