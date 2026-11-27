# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Hình dạng thân request và phản hồi của API quy trình. FastAPI dùng các model này để
# kiểm dữ liệu vào, ra và sinh OpenAPI; bản OpenAPI được lưu ở
# contracts/workflow-api.openapi.json làm hợp đồng cho giao diện và gói nghiệp vụ. Đổi
# model thì chạy `make contracts`.

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class VariablesBody(BaseModel):
    # Khóa lạ ở lớp ngoài chắc chắn là gửi nhầm, thường do quên lớp `variables`. Nếu bỏ qua
    # nó, biến của người gọi mất trong im lặng: gửi {"approved": true} vẫn hoàn thành task
    # nhưng quy trình không nhận được `approved` và rẽ sang nhánh mặc định.
    model_config = ConfigDict(extra="forbid")

    variables: dict[str, object] | None = Field(
        default=None, description="Biến gửi cho quy trình; bỏ trống thì coi như không có biến"
    )


class ProcessStarted(BaseModel):
    id: str = Field(description="Mã quy trình vừa khởi tạo")
    process: str = Field(description="Khóa của định nghĩa quy trình (BPMN)")


class Task(BaseModel):
    id: str
    name: str
    tenant: str = Field(
        description="Tenant của hồ sơ. Khác tenant của người gọi khi bước thuộc thẩm quyền của tenant cha "
        "theo bảng phân cấp: lúc lập hồ sơ, workflow-api gán bước cho nhóm của tenant cha (ADR 0029)"
    )
    step: str = Field(
        description="Mã bước trong BPMN (id của userTask); cùng `process` xác định khai báo của bước"
    )
    process: str = Field(description="Khóa của định nghĩa quy trình (BPMN)")
    due: str | None = Field(description="Hạn xử lý, ISO 8601; null nếu bước không đặt hạn")
    category: str | None = Field(description="`four-eyes` nếu người khởi tạo không được tự hoàn thành")
    processInstanceId: str
    created: str = Field(description="Thời điểm tạo task, ISO 8601")
    assignee: str | None = Field(
        description="`sub` của người được giao; null nếu task còn chờ nhận theo vai trò"
    )
    variables: dict[str, object]


class Seal(BaseModel):
    hash: str = Field(
        description="SHA-256 (hex) của bản JSON chuẩn của hồ sơ: trường của các bước, lịch sử bước, kết quả "
        "(ADR 0053); `make seal-verify` dựng lại từ lịch sử Flowable và so"
    )
    sealed_at: str = Field(description="Thời điểm niêm phong, ISO 8601")
    version: int = Field(description="Phiên bản cách dựng bản JSON chuẩn")


SEAL_DESCRIPTION = (
    "Niêm phong của hồ sơ; null khi quy trình không khai niêm phong (`mortise:seal` trong BPMN), hồ sơ chưa "
    "kết thúc hay bị dừng mà không tới sự kiện kết thúc nào"
)


class InstanceStatus(BaseModel):
    id: str
    ended: bool
    outcome: str | None = Field(description="Mã sự kiện kết thúc; null khi quy trình chưa xong")
    seal: Seal | None = Field(description=SEAL_DESCRIPTION)


class CurrentStep(BaseModel):
    step: str = Field(description="id của bước người làm (userTask) hay bước chờ trong BPMN")
    name: str
    due: str | None = Field(description="Hạn xử lý, ISO 8601; null nếu bước không đặt hạn hay là bước chờ")


class CaseSummary(BaseModel):
    id: str = Field(description="Mã hồ sơ (quy trình)")
    process: str = Field(description="Khóa của định nghĩa quy trình (BPMN)")
    started: str = Field(description="Thời điểm lập, ISO 8601")
    ended: str | None = Field(description="Thời điểm kết thúc, ISO 8601; null khi hồ sơ còn mở")
    outcome: str | None = Field(
        description="Mã sự kiện kết thúc; null khi hồ sơ còn mở hay bị dừng mà không tới sự kiện kết thúc nào"
    )
    outcomeName: str | None = Field(description="Tên sự kiện kết thúc trong BPMN")
    current: list[CurrentStep] = Field(description="Bước hồ sơ đang chờ; rỗng khi hồ sơ đã kết thúc")
    variables: dict[str, object] = Field(
        description="Biến người lập thấy: không có biến lõi đặt và trường của bất kỳ bước nào (ADR 0032)"
    )


class CaseList(BaseModel):
    total: int = Field(description="Số hồ sơ khớp bộ lọc, không chỉ trang này")
    items: list[CaseSummary]


class CaseStep(BaseModel):
    step: str
    name: str
    kind: Literal["task", "wait"] = Field(
        description="`task`: bước người làm; `wait`: bước chờ, ví dụ hẹn giờ"
    )
    started: str
    ended: str | None
    due: str | None
    status: Literal["open", "done", "cancelled"] = Field(
        description="`cancelled`: bước dừng mà không ai hoàn thành, ví dụ hết hạn hay hồ sơ bị hủy"
    )
    groups: list[str] = Field(
        description="Nhóm ứng viên: vai trò, hoặc `<tenant>/<vai trò>` với bước của tenant cha (ADR 0029); "
        "không có tên hay mã người xử lý"
    )
    claimed: bool = Field(description="Đã có người nhận bước")


class CaseDetail(CaseSummary):
    steps: list[CaseStep] = Field(description="Bước đã qua và đang chờ, theo thời điểm bắt đầu")
    seal: Seal | None = Field(description=SEAL_DESCRIPTION)


class StepCounts(BaseModel):
    step: str = Field(description="id của bước người làm (userTask) trong BPMN mới nhất của quy trình")
    name: str
    open: int = Field(description="Số bước này đang chờ")
    overdue: int = Field(description="Trong số đó, số bước có hạn xử lý trước `counted_at`")


class ProcessCounts(BaseModel):
    process: str = Field(description="Khóa của định nghĩa quy trình (BPMN)")
    open: int = Field(
        description="Số hồ sơ còn mở trong tenant của người gọi; có thể lớn hơn tổng `steps[].open` khi hồ "
        "sơ đang ở bước chờ (hẹn giờ) hay ở bước chỉ có trong phiên bản BPMN cũ"
    )
    finished: int = Field(description="Số hồ sơ đã kết thúc, kể cả hồ sơ bị dừng giữa chừng")
    overdue: int = Field(
        description="Số bước đang chờ (không phải số hồ sơ) có hạn xử lý trước `counted_at`, tính trên mọi "
        "bước của quy trình"
    )
    steps: list[StepCounts] = Field(description="Mỗi bước người làm của BPMN mới nhất, theo thứ tự trong tệp")
    counted_at: str = Field(description="Thời điểm đếm, ISO 8601 UTC; hạn so với thời điểm này")


class ErrorBody(BaseModel):
    error: str = Field(description="Lý do bằng tiếng Việt, hiển thị được cho người dùng")


# 400, 401 và 422 khai cho mọi route: route nào cũng kiểm token và header X-Mortise-Tenant, và FastAPI tự ghi
# 422 theo dạng mặc định của nó vào OpenAPI nếu route không khai, lệch với dạng {"error": "..."} thật sự trả
# về.
def error_responses(*codes: int) -> dict:
    return {code: {"model": ErrorBody} for code in (400, 401, 422, *codes)}
