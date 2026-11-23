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
# Tiền tố của biến lõi đặt từ bảng phân cấp thẩm quyền (ADR 0028). Client đặt được thì người lập tự chọn người
# duyệt cho hồ sơ của mình, và người hoàn thành một bước đổi được người nhận các bước sau.
RESERVED_PREFIX = "authority_"

# Đủ cho UUID và mã ngẫu nhiên base64url; giới hạn độ dài để khóa không phình biến của Flowable.
_IDEMPOTENCY_KEY = re.compile(r"[A-Za-z0-9_-]{8,100}")

# Người có vai trò này phải đăng nhập hai bước (ADR 0011). Keycloak đã bắt nhập mã OTP lúc đăng nhập, vì điều
# kiện `approver-role` trong core/keycloak/realm-mortise.json là vai trò `otp_required` của client mortise-web
# mà manager gộp sẵn; kiểm lại ở đây để lỡ luồng đăng nhập hay vai trò gộp bị cấu hình sai thì người duyệt
# chỉ có mật khẩu vẫn không duyệt được. otp_required không nằm trong vai trò realm của token nên không kiểm
# theo nó.
APPROVER_ROLE = "manager"
# Giá trị trong claim `amr` mà Keycloak ghi khi người dùng đã nhập đúng mã OTP (cấu hình `amr-otp` của realm).
SECOND_FACTOR = "otp"


@dataclass(frozen=True)
class Caller:
    sub: str
    username: str
    tenant: str
    roles: frozenset[str]
    # Cách đã đăng nhập, từ claim `amr` của token: "pwd" là mật khẩu, "otp" là mã OTP.
    methods: frozenset[str] = frozenset()
    # Tài khoản dịch vụ mở quy trình thay cho tenant ghi ở header (ADR 0017), không phải một người.
    service: bool = False


@dataclass(frozen=True)
class TaskView:
    tenant: str
    assignee: str | None
    candidate_groups: frozenset[str]
    category: str | None
    initiator: str | None
    # Quy trình có biến `authority_<bước>` của bước này, tức vai trò của bước lấy từ bảng phân cấp (ADR 0028).
    authority: bool = False


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
    # Bước lấy vai trò từ bảng phân cấp cần OTP với mọi vai trò: chỉ xét vai trò manager thì đổi một dòng
    # sang vai trò khác là bỏ được bước OTP của chính bước cần thẩm quyền.
    if (APPROVER_ROLE in caller.roles or task.authority) and SECOND_FACTOR not in caller.methods:
        raise Denied(
            403, "Người duyệt phải đăng nhập hai bước (mật khẩu và mã OTP); đăng xuất rồi đăng nhập lại."
        )
    if task.assignee is not None and task.assignee != caller.sub:
        raise Denied(403, "Task đã được giao cho người khác.")
    if task.assignee is None and not (task.candidate_groups & caller.roles):
        raise Denied(403, "Vai trò của bạn không được xử lý task này.")
    if task.category == FOUR_EYES and task.initiator == caller.sub:
        raise Denied(403, "Quy tắc bốn mắt: người gửi yêu cầu không được tự duyệt.")


def check_person(caller: Caller) -> None:
    """Tài khoản dịch vụ chỉ được mở quy trình: không có vai trò nên không xem hay xử lý task của ai."""
    if caller.service:
        raise Denied(403, "Tài khoản dịch vụ chỉ được mở quy trình.")


def check_variables(variables: dict[str, object]) -> None:
    clash = (RESERVED_VARIABLES & variables.keys()) | {n for n in variables if n.startswith(RESERVED_PREFIX)}
    if clash:
        raise Denied(
            400,
            f"Không được đặt biến dành riêng cho lõi: {', '.join(sorted(clash))}. Lõi tự đặt "
            f"{', '.join(sorted(RESERVED_VARIABLES))} và mọi biến bắt đầu bằng {RESERVED_PREFIX}.",
        )


def check_not_preset(variables: dict[str, object], decisions: frozenset[str]) -> None:
    """Người lập không được đặt sẵn biến quyết định (ADR 0025).

    Người hoàn thành bước không gửi biến đó thì cổng rẽ nhánh đọc giá trị người lập đặt, tức người lập tự
    duyệt.
    """
    preset = decisions & variables.keys()
    if preset:
        raise Denied(
            400,
            f"Không được đặt sẵn biến do người xử lý bước quyết định: {', '.join(sorted(preset))}. "
            "Biến này chỉ gửi khi hoàn thành bước.",
        )


def check_idempotency_key(key: str) -> None:
    if not _IDEMPOTENCY_KEY.fullmatch(key):
        raise Denied(400, "Idempotency-Key phải dài 8–100 ký tự, chỉ gồm chữ, số, '-' và '_'.")
