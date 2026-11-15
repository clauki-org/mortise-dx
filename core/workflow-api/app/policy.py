# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Quy tắc quyết định ai được làm gì với task. Hàm thuần, không gọi mạng, để kiểm thử
# đầy đủ; main.py lấy dữ liệu từ Flowable rồi hỏi các hàm ở đây.

import re
from dataclasses import dataclass

FOUR_EYES = "four-eyes"

# Biến lưu Idempotency-Key của yêu cầu khởi tạo, để lần gửi lặp tìm lại được quy trình đã tạo.
IDEMPOTENCY_VARIABLE = "idempotencyKey"

# Biến do lõi đặt; ứng dụng không được ghi đè khi khởi tạo hay hoàn thành task.
RESERVED_VARIABLES = frozenset({"initiator", "initiatorName", "tenant", IDEMPOTENCY_VARIABLE})

# Đủ cho UUID và mã ngẫu nhiên base64url; giới hạn độ dài để khóa không phình biến của Flowable.
_IDEMPOTENCY_KEY = re.compile(r"[A-Za-z0-9_-]{8,100}")


@dataclass(frozen=True)
class Caller:
    sub: str
    username: str
    tenant: str
    roles: frozenset[str]


@dataclass(frozen=True)
class TaskView:
    tenant: str
    assignee: str | None
    candidate_groups: frozenset[str]
    category: str | None
    initiator: str | None


class Denied(Exception):
    def __init__(self, status: int, reason: str):
        super().__init__(reason)
        self.status = status
        self.reason = reason


def check_can_complete(caller: Caller, task: TaskView) -> None:
    """Ném Denied nếu caller không được hoàn thành task; trả về bình thường nếu được."""
    # Task của tenant khác trả 404 chứ không phải 403, để không lộ việc task tồn tại.
    if task.tenant != caller.tenant:
        raise Denied(404, "Không tìm thấy task.")
    if task.assignee is not None and task.assignee != caller.sub:
        raise Denied(403, "Task đã được giao cho người khác.")
    if task.assignee is None and not (task.candidate_groups & caller.roles):
        raise Denied(403, "Vai trò của bạn không được xử lý task này.")
    if task.category == FOUR_EYES and task.initiator == caller.sub:
        raise Denied(403, "Quy tắc bốn mắt: người gửi yêu cầu không được tự duyệt.")


def check_variables(variables: dict[str, object]) -> None:
    clash = RESERVED_VARIABLES & variables.keys()
    if clash:
        raise Denied(400, f"Không được đặt biến dành riêng cho lõi: {', '.join(sorted(clash))}.")


def check_idempotency_key(key: str) -> None:
    if not _IDEMPOTENCY_KEY.fullmatch(key):
        raise Denied(400, "Idempotency-Key phải dài 8–100 ký tự, chỉ gồm chữ, số, '-' và '_'.")
