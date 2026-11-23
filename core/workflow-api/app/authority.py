# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Bảng phân cấp thẩm quyền (ADR 0028): bước nào trong BPMN ghi `${authority_<bước>}` ở candidateGroups thì
# vai trò của bước đó lấy từ core.step_authorities của tenant lúc khởi tạo, không viết cứng trong BPMN. Hàm
# thuần, không gọi mạng: flowable.py đưa BPMN, db.py đưa các dòng của bảng, main.py ghép lại.

import math
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass

from .policy import RESERVED_PREFIX as PREFIX

BPMN = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"
FLOWABLE = "{http://flowable.org/bpmn}"
# Bảng cho ra vai trò, tức nhóm ứng viên; ở candidateUsers vai trò thành mã người dùng và task không ai nhận.
_GROUPS = f"{FLOWABLE}candidateGroups"
_USERS = f"{FLOWABLE}candidateUsers"
# Định danh UEL theo quy tắc của Java, như decisions.py.
_NAME = re.compile(r"[^\W\d]\w*")

TENANT, PARENT = "tenant", "parent"


@dataclass(frozen=True)
class Row:
    """Một dòng của core.step_authorities cho một bước của một tenant."""

    rule: str
    # Biến lúc khởi tạo đem so với `above`; None ở dòng gốc.
    variable: str | None
    above: float | None
    role: str
    scope: str = TENANT


def authority_steps(bpmn: bytes, key: str) -> frozenset[str]:
    """Bước mà quy trình `key` đọc vai trò từ bảng phân cấp: tên `authority_<bước>` trong candidateGroups.

    Ném ValueError nếu tệp không đọc được, không có quy trình `key`, hay candidateUsers dùng tên
    `authority_*`.
    """
    try:
        # BPMN chỉ vào được Flowable qua bộ cài bằng tài khoản quản trị, như decisions.py.
        root = ET.fromstring(bpmn)  # noqa: S314
    except ET.ParseError as error:
        raise ValueError(f"BPMN sai cú pháp: {error}") from error
    process = next((p for p in root.iter(f"{BPMN}process") if p.get("id") == key), None)
    if process is None:
        raise ValueError(f'không có <process id="{key}">')
    steps = set()
    for task in process.iter(f"{BPMN}userTask"):
        if _authority_names(task.get(_USERS, "")):
            raise ValueError(
                f"userTask '{task.get('id')}' dùng {PREFIX}* ở candidateUsers; bảng phân cấp chỉ cho "
                "candidateGroups"
            )
        steps.update(name.removeprefix(PREFIX) for name in _authority_names(task.get(_GROUPS, "")))
    return frozenset(steps)


def _authority_names(expression: str) -> list[str]:
    return [name for name in _NAME.findall(expression) if name.startswith(PREFIX) and len(name) > len(PREFIX)]


def _amount(value: object) -> float | None:
    """Số dùng để so với ngưỡng; None khi không so được.

    bool là int trong Python: không loại thì `true` thành 1. NaN và vô cực so với ngưỡng nào cũng cho kết
    quả vô nghĩa. Số âm không phải một mức hợp lệ.
    """
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    if not math.isfinite(value) or value < 0:
        return None
    return float(value)


def pick(rows: list[Row], variables: dict[str, object], parent: str | None) -> Row | None:
    """Dòng áp cho hồ sơ: dòng có ngưỡng cao nhất mà hồ sơ vượt, không có thì dòng gốc.

    Biến thiếu, không phải số, âm thì coi như vượt mọi ngưỡng, tức đi tới người có thẩm quyền cao nhất, như
    BPMN của gói coi biến ngưỡng thiếu hay âm là nhánh nặng: người lập bỏ trống biến thì không né được cấp
    trên.
    Dòng cấp tenant cha bị bỏ qua khi tenant không có cha, để hồ sơ không tới một nhóm không ai có.
    """
    usable = [row for row in rows if row.scope == TENANT or parent is not None]
    matched = []
    for row in usable:
        if row.above is None or row.variable is None:
            continue
        amount = _amount(variables.get(row.variable))
        if amount is None or amount > row.above:
            matched.append(row)
    if matched:
        # Cùng ngưỡng thì chọn theo mã dòng, để hai lần khởi tạo giống nhau luôn tới cùng người.
        return max(matched, key=lambda row: (row.above, row.rule))
    return next((row for row in usable if row.above is None), None)


def group(row: Row, parent: str | None) -> str:
    """Nhóm ứng viên của task. Dòng cấp cha cho `<tenant cha>/<vai trò>`: người của tenant cha có vai trò đó
    thấy và hoàn thành task (ADR 0029, policy.check_parent_can_complete)."""
    if row.scope == PARENT and parent is not None:
        return f"{parent}/{row.role}"
    return row.role
