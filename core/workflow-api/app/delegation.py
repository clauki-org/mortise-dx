# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Bước của tenant con mà bảng phân cấp giao lên tenant cha (ADR 0029): dòng `scope: parent` đặt nhóm ứng
# viên `<tenant cha>/<vai trò>` lúc khởi tạo (ADR 0028). Module này tìm các task đó cho bảng việc của người
# tenant cha; quyền hoàn thành nằm ở policy.check_parent_can_complete, main.py ghép hai phần.

from . import db, flowable
from .policy import RESERVED_PREFIX, Caller, parent_groups


def tasks(caller: Caller) -> list[dict]:
    """Task của tenant con trực tiếp, chờ nhóm tenant của caller hoặc đã giao cho chính caller.

    Truy vấn Flowable trước, không lọc tenant; chỉ khi có task của tenant khác mới đọc CSDL. Đọc CSDL mọi lần
    thì người không có việc nào từ tenant con cũng mất bảng việc khi CSDL lỗi.
    """
    groups = parent_groups(caller)
    if not groups:
        return []
    # Cả task đã giao: người của tenant cha nhận task rồi lần hoàn thành lỗi thì task nằm ở tên họ, và truy
    # vấn theo tenant của họ không thấy nó. Task đã giao cho người khác thì không hiện.
    found = [
        task
        for task in flowable.tasks(None, groups=groups, any_assignee=True)
        if task.get("tenantId") != caller.tenant
        and task.get("assignee") in (None, caller.sub)
        and _reads_authority_table(task)
    ]
    if not found:
        return []
    # Chỉ tenant con lúc này: tenant đổi cha sau khi lập hồ sơ thì nhóm của task vẫn mang tên cha cũ, mà cha
    # cũ không còn quyền với hồ sơ của nó.
    children = db.children(caller.tenant)
    return [task for task in found if task.get("tenantId") in children]


def _reads_authority_table(task: dict) -> bool:
    """Bước lấy vai trò từ bảng phân cấp, như điều kiện hoàn thành của policy.check_parent_can_complete.

    Không lọc thì bước viết sẵn nhóm có dấu `/` trong BPMN hiện trên bảng việc của tenant cha, kèm mọi biến
    của hồ sơ, rồi trả 404 khi hoàn thành.
    """
    names = {variable["name"] for variable in task.get("variables", [])}
    return f"{RESERVED_PREFIX}{task.get('taskDefinitionKey')}" in names
