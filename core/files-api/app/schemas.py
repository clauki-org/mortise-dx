# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Hình dạng phản hồi của files-api. FastAPI dùng các model này để kiểm dữ liệu trả về và sinh
# OpenAPI; bản OpenAPI lưu ở contracts/files-api.openapi.json làm hợp đồng cho giao diện và gói.
# Đổi model thì chạy `make contracts`.

from pydantic import BaseModel, Field


class FileInfo(BaseModel):
    id: str = Field(description="Mã tệp (UUID), dùng để đọc thông tin và tải xuống")
    name: str = Field(description="Tên tệp người tải lên đặt, đã bỏ phần thư mục")
    contentType: str = Field(description="Kiểu nội dung lúc tải lên")
    size: int = Field(description="Cỡ tệp, byte")
    sha256: str = Field(description="Băm SHA-256 của nội dung, hệ 16")
    uploadedBy: str = Field(description="`sub` của người tải lên")
    status: str = Field(
        description="`clean`: đã quét, không thấy mã độc; `unscanned`: tải lên trước khi có bước quét"
    )
    created: str = Field(description="Thời điểm tải lên, ISO 8601")


class ErrorBody(BaseModel):
    error: str = Field(description="Lý do bằng tiếng Việt, hiển thị được cho người dùng")
