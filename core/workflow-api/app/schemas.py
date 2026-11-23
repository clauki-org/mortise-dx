# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Hình dạng thân request và phản hồi của API quy trình. FastAPI dùng các model này để
# kiểm dữ liệu vào, ra và sinh OpenAPI; bản OpenAPI được lưu ở
# contracts/workflow-api.openapi.json làm hợp đồng cho giao diện và gói nghiệp vụ. Đổi
# model thì chạy `make contracts`.

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
        description="Tenant của hồ sơ. Khác tenant của người gọi khi bảng phân cấp giao bước của tenant con "
        "lên tenant cha (ADR 0029)"
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


class InstanceStatus(BaseModel):
    id: str
    ended: bool
    outcome: str | None = Field(description="Mã sự kiện kết thúc; null khi quy trình chưa xong")


class ErrorBody(BaseModel):
    error: str = Field(description="Lý do bằng tiếng Việt, hiển thị được cho người dùng")
