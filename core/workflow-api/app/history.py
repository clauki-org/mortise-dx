# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Truy vấn Flowable cho người lập theo dõi hồ sơ của mình (ADR 0032): hồ sơ, bước đang chờ, lịch sử bước. Cùng
# lối gọi với flowable.py (tài khoản kỹ thuật, lỗi thành Denied), tách riêng vì đây là phần chỉ đọc lịch sử.
# Mọi truy vấn hồ sơ lọc theo tenant và biến `initiator` ngay ở Flowable; Flowable bỏ qua im lặng khóa lọc nó
# không biết (processInstanceIdIn của /query/tasks trả mọi task), nên chỉ dùng khóa đã thử thấy lọc thật.

from . import flowable


def _initiator(sub: str) -> list[dict[str, str]]:
    return [{"name": "initiator", "value": sub, "operation": "equals", "type": "string"}]


def cases(
    tenant: str, initiator: str, processes: list[str], finished: bool | None, start: int, size: int
) -> tuple[int, list[dict]]:
    """Một trang hồ sơ do `initiator` lập trong `tenant`, mới nhất trước, kèm biến; trả (tổng, trang)."""
    query: dict[str, object] = {
        "tenantId": tenant,
        "variables": _initiator(initiator),
        "includeProcessVariables": True,
        "sort": "startTime",
        "order": "desc",
        "start": start,
        "size": size,
    }
    if processes:
        query["processDefinitionKeyIn"] = processes
    if finished is not None:
        query["finished"] = finished
    response = flowable._call("POST", "/query/historic-process-instances", json=query)
    flowable._ensure_ok(response, "đọc hồ sơ")
    page = response.json()
    return page["total"], page["data"]


def case(instance_id: str, tenant: str, initiator: str) -> dict | None:
    """Hồ sơ `instance_id` nếu nó thuộc `tenant` và do `initiator` lập; ba điều kiện trong một truy vấn.

    Kiểm một lần ở Flowable thay vì đọc rồi so: không có nhánh nào trả lời khác nhau giữa hồ sơ không tồn
    tại, hồ sơ của tenant khác và hồ sơ của người khác.
    """
    query = {
        "processInstanceId": instance_id,
        "tenantId": tenant,
        "variables": _initiator(initiator),
        "includeProcessVariables": True,
    }
    response = flowable._call("POST", "/query/historic-process-instances", json=query)
    flowable._ensure_ok(response, "đọc hồ sơ")
    data = response.json()["data"]
    return data[0] if data else None


def open_tasks(tenant: str, initiator: str) -> list[dict]:
    """Task đang chờ của mọi hồ sơ còn mở do `initiator` lập, trong một truy vấn cho cả trang hồ sơ."""
    query = {"tenantId": tenant, "processInstanceVariables": _initiator(initiator), "sort": "id"}
    return flowable.read_all("/query/tasks", query, "đọc bước đang chờ", f"người lập {initiator}")


def waiting(tenant: str, initiator: str) -> list[dict]:
    """Nhánh đang chạy của các hồ sơ do `initiator` lập: activityId cho biết hồ sơ đang ở bước chờ nào."""
    # Truy vấn nhánh không sắp theo id được (Flowable trả 400); sắp theo hồ sơ là thứ tự ổn định gần nhất.
    query = {
        "tenantId": tenant,
        "processInstanceVariables": _initiator(initiator),
        "sort": "processInstanceId",
    }
    return flowable.read_all("/query/executions", query, "đọc bước chờ", f"người lập {initiator}")


def task_history(instance_id: str) -> list[dict]:
    query = {"processInstanceId": instance_id, "sort": "startTime", "order": "asc"}
    return flowable.read_all("/query/historic-task-instances", query, "đọc lịch sử bước", instance_id)


def wait_history(instance_id: str) -> list[dict]:
    """Bước chờ (intermediateCatchEvent) đã qua và đang chờ; bỏ startEvent, sequenceFlow, gateway."""
    query = {
        "processInstanceId": instance_id,
        "activityType": "intermediateCatchEvent",
        "sort": "startTime",
        "order": "asc",
    }
    return flowable.read_all("/query/historic-activity-instances", query, "đọc lịch sử bước chờ", instance_id)


def groups_of(task: dict) -> frozenset[str]:
    """Nhóm ứng viên của một task trong lịch sử; task đang chờ đọc ở runtime như khi hoàn thành."""
    if task.get("endTime") is None:
        return flowable.candidate_groups(task["id"])
    response = flowable._call("GET", f"/history/historic-task-instances/{task['id']}/identitylinks")
    flowable._ensure_ok(response, "đọc nhóm của bước")
    # Lịch sử ghi nhóm ở `groupId`, runtime ở `group`.
    return frozenset(
        link["groupId"] for link in response.json() if link.get("type") == "candidate" and link.get("groupId")
    )
