# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Quy tắc của lớp đọc NGSI-LD. Hàm thuần, không gọi mạng, để kiểm thử đầy đủ; main.py hỏi các
# hàm ở đây trước khi gọi Scorpio (scorpio.py).
#
# Tenant đi tới Scorpio luôn là tenant trong token, không bao giờ lấy từ yêu cầu: Scorpio tách
# dữ liệu theo header NGSILD-Tenant (mỗi tenant một CSDL), nên ai đặt được header đó là đọc được
# dữ liệu của đơn vị khác.

import re
from dataclasses import dataclass

# Tham số truy vấn NGSI-LD được chuyển tiếp. Tham số khác bị từ chối thay vì chuyển nguyên: Scorpio
# có tham số điều khiển việc hỏi broker khác (`local`) và định dạng (`format`, `options` có `sysAttrs`),
# lớp này chỉ mở phần cần để đọc thiết bị của đơn vị mình.
QUERY_PARAMETERS = frozenset({"type", "id", "idPattern", "attrs", "q", "limit", "offset"})
MAX_LIMIT = 1000
# `q` và `idPattern` (biểu thức chính quy) chạy trên Scorpio dùng chung cho mọi tenant; giới hạn độ dài để
# một truy vấn quá lớn không làm chậm tenant khác. Không chặn được hết biểu thức chạy lâu (ADR 0012).
MAX_PARAMETER_LENGTH = 300
# Tenant đi vào header HTTP và thành tên CSDL ở Scorpio: chỉ nhận dạng slug như trong contracts/.
_TENANT = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")

# URI của entity theo NGSI-LD; giới hạn độ dài để đường dẫn không phình.
_ENTITY_ID = re.compile(r"urn:ngsi-ld:[A-Za-z0-9._:-]{1,200}")


@dataclass(frozen=True)
class Caller:
    sub: str
    tenant: str


class Denied(Exception):
    def __init__(self, status: int, reason: str):
        super().__init__(reason)
        self.status = status
        self.reason = reason


def clean_query(params: list[tuple[str, str]]) -> dict[str, str]:
    """Tham số được chuyển cho Scorpio; tham số lạ, lặp lại hay limit ngoài khoảng thì Denied(400)."""
    unknown = sorted({name for name, _ in params} - QUERY_PARAMETERS)
    if unknown:
        allowed = ", ".join(sorted(QUERY_PARAMETERS))
        raise Denied(400, f"Tham số không hỗ trợ: {', '.join(unknown)}. Chỉ nhận: {allowed}.")
    names = [name for name, _ in params]
    repeated = sorted({name for name in names if names.count(name) > 1})
    if repeated:
        raise Denied(400, f"Tham số lặp lại: {', '.join(repeated)}.")
    cleaned = dict(params)
    too_long = sorted(name for name, value in cleaned.items() if len(value) > MAX_PARAMETER_LENGTH)
    if too_long:
        raise Denied(400, f"Tham số dài quá {MAX_PARAMETER_LENGTH} ký tự: {', '.join(too_long)}.")
    if "limit" in cleaned and not (cleaned["limit"].isdigit() and 1 <= int(cleaned["limit"]) <= MAX_LIMIT):
        raise Denied(400, f"limit phải là số từ 1 tới {MAX_LIMIT}.")
    if "offset" in cleaned and not cleaned["offset"].isdigit():
        raise Denied(400, "offset phải là số không âm.")
    return cleaned


def check_tenant(tenant: str) -> None:
    if not _TENANT.fullmatch(tenant):
        raise Denied(403, "Mã tenant trong token không đúng dạng (chữ thường, số, gạch nối).")


def check_entity_id(entity_id: str) -> None:
    if not _ENTITY_ID.fullmatch(entity_id):
        raise Denied(400, "Mã entity phải có dạng urn:ngsi-ld:<loại>:<mã>.")
