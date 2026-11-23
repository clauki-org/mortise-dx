# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Quy tắc quyết định ai được làm gì với task. Hàm thuần, không gọi mạng, để kiểm thử
# đầy đủ; main.py lấy dữ liệu từ Flowable rồi hỏi các hàm ở đây.

import re
from collections.abc import Mapping
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
_NEED_SECOND_FACTOR = "Người duyệt phải đăng nhập hai bước (mật khẩu và mã OTP); đăng xuất rồi đăng nhập lại."


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
        raise Denied(403, _NEED_SECOND_FACTOR)
    if task.assignee is not None and task.assignee != caller.sub:
        raise Denied(403, "Task đã được giao cho người khác.")
    if task.assignee is None and not (task.candidate_groups & caller.roles):
        raise Denied(403, "Vai trò của bạn không được xử lý task này.")
    if task.category == FOUR_EYES and task.initiator == caller.sub:
        raise Denied(403, "Quy tắc bốn mắt: người gửi yêu cầu không được tự duyệt.")


def parent_groups(caller: Caller) -> list[str]:
    """Nhóm ứng viên của bước được gán cho tenant của caller: `<tenant>/<vai trò>` (ADR 0029).

    Ghép từ tenant và vai trò của caller chứ không tách nhóm của task ra: mã tenant không bị cấm chứa `/`, nên
    tách thì `a/b` + `c` và `a` + `b/c` cho cùng một nhóm. Phép so tenant cha ở check_parent_can_complete phân
    định trường hợp đó.
    """
    return sorted(f"{caller.tenant}/{role}" for role in caller.roles)


def delegated_to(caller: Caller, task: TaskView) -> bool:
    """Task của tenant khác mà nhóm ứng viên là nhóm tenant của caller; chưa xét tenant cha (cần CSDL)."""
    return task.tenant != caller.tenant and bool(task.candidate_groups & set(parent_groups(caller)))


def check_parent_can_complete(caller: Caller, task: TaskView, children: frozenset[str]) -> None:
    """Người của tenant cha hoàn thành bước thuộc thẩm quyền của mình trong hồ sơ tenant con (ADR 0029).

    `children` là tenant con trực tiếp của caller lúc này, đọc từ core.tenants.
    """
    # Mọi điều kiện xác định task có thuộc phạm vi của caller hay không đều trả 404 như task của tenant khác:
    # 403 cho biết task tồn tại. Bước không đọc bảng phân cấp thì không thành việc của tenant cha, kể cả khi
    # BPMN viết sẵn nhóm có dấu `/`.
    if not (delegated_to(caller, task) and task.tenant in children and task.authority):
        raise Denied(404, "Không tìm thấy task.")
    # Luôn cần OTP, không xét vai trò: bước của tenant cha là bước đọc bảng phân cấp (ADR 0028), và người ở
    # tenant khác quyết định thay cho tenant con.
    if SECOND_FACTOR not in caller.methods:
        raise Denied(403, _NEED_SECOND_FACTOR)
    if task.assignee is not None and task.assignee != caller.sub:
        raise Denied(403, "Task đã được giao cho người khác.")
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


def check_start_fields(variables: dict[str, object], fields: Mapping[str, frozenset[str]]) -> None:
    """Người lập không được gửi trường của một bước (ADR 0031): nội dung của bước chỉ người làm bước ghi.

    Gửi sẵn được thì người làm bước bỏ trống trường đó là nội dung người lập đặt thành nội dung của bước.
    """
    _refuse_fields(variables, fields, frozenset(), "Người lập không gửi được trường của một bước")


def check_step_fields(variables: dict[str, object], fields: Mapping[str, frozenset[str]], step: str) -> None:
    """Người hoàn thành bước `step` không được gửi trường của bước khác (ADR 0031).

    Trường mà nhiều bước cùng khai thì mỗi bước đó đều ghi được. Biến không là trường của bước nào vẫn gửi
    được như trước.
    """
    own = fields.get(step, frozenset())
    _refuse_fields(variables, fields, own, f"Hoàn thành bước '{step}' không gửi được trường của bước khác")


def _refuse_fields(
    variables: dict[str, object], fields: Mapping[str, frozenset[str]], own: frozenset[str], refusal: str
) -> None:
    foreign = {
        name: sorted(other for other, names in fields.items() if name in names)
        for name in sorted(variables.keys() - own)
        if any(name in names for names in fields.values())
    }
    if foreign:
        listed = "; ".join(f"{name} (bước {', '.join(steps)})" for name, steps in foreign.items())
        raise Denied(
            400,
            f"{refusal}: {listed}. Trường của một bước chỉ do người hoàn thành bước đó gửi.",
        )


def check_idempotency_key(key: str) -> None:
    if not _IDEMPOTENCY_KEY.fullmatch(key):
        raise Denied(400, "Idempotency-Key phải dài 8–100 ký tự, chỉ gồm chữ, số, '-' và '_'.")
