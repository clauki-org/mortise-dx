# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Hình dạng phản hồi của context-api, dùng để sinh OpenAPI trong contracts/context-api.openapi.json.
# Entity NGSI-LD có thuộc tính tùy loại thiết bị, nên model chỉ chốt id và type, phần còn lại giữ nguyên
# như Scorpio trả về (dạng JSON rút gọn với ngữ cảnh lõi NGSI-LD). Đổi model thì chạy `make contracts`.

from pydantic import BaseModel, ConfigDict, Field


class Entity(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str = Field(description="URI của entity, ví dụ urn:ngsi-ld:Device:kho-01")
    type: str = Field(description="Loại entity, ví dụ Device")


class ErrorBody(BaseModel):
    error: str = Field(description="Lý do bằng tiếng Việt, hiển thị được cho người dùng")
