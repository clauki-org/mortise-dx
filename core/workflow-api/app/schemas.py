# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Hình dạng phản hồi của API quy trình. FastAPI dùng các model này để kiểm dữ liệu trả
# về và sinh OpenAPI; bản OpenAPI được lưu ở contracts/workflow-api.openapi.json làm
# hợp đồng cho giao diện và gói nghiệp vụ. Đổi model thì chạy `make contracts`.

from pydantic import BaseModel, Field


class ProcessStarted(BaseModel):
    id: str = Field(description="Mã quy trình vừa khởi tạo")
    process: str = Field(description="Khóa của định nghĩa quy trình (BPMN)")


class Task(BaseModel):
    id: str
    name: str
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
