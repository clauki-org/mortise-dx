# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Truy vấn Flowable cho người lập theo dõi hồ sơ của mình (ADR 0032): hồ sơ, bước đang chờ, lịch sử bước. Cùng
# lối gọi với flowable.py (tài khoản kỹ thuật, lỗi thành Denied), tách riêng vì đây là phần chỉ đọc lịch sử.
# Mọi truy vấn hồ sơ lọc theo tenant và biến `initiator` ngay ở Flowable; Flowable bỏ qua im lặng khóa lọc nó
# không biết (processInstanceIdIn của /query/tasks trả mọi task), nên chỉ dùng khóa đã thử thấy lọc thật, và
# mọi dòng trả về được lọc lại ở đây theo đúng điều kiện đã gửi: một khóa lọc bị bỏ qua ở phiên bản sau không
# làm lộ hồ sơ của người khác.

from . import flowable
from .policy import Denied


def _initiator(sub: str) -> list[dict[str, str]]:
    return [{"name": "initiator", "value": sub, "operation": "equals", "type": "string"}]


def _owned(raw: dict, tenant: str, initiator: str) -> bool:
    """Hồ sơ (historic process instance kèm biến) thuộc `tenant` và do `initiator` lập."""
    variables = {v["name"]: v.get("value") for v in raw.get("variables", [])}
    return raw.get("tenantId") == tenant and variables.get("initiator") == initiator


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
    return page["total"], [raw for raw in page["data"] if _owned(raw, tenant, initiator)]


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
    found = [raw for raw in response.json()["data"] if raw["id"] == instance_id]
    return found[0] if found and _owned(found[0], tenant, initiator) else None


def open_tasks(tenant: str, initiator: str) -> list[dict]:
    """Task đang chờ của mọi hồ sơ còn mở do `initiator` lập, trong một truy vấn cho cả trang hồ sơ."""
    query = {"tenantId": tenant, "processInstanceVariables": _initiator(initiator), "sort": "id"}
    found = flowable.read_all("/query/tasks", query, "đọc bước đang chờ", f"người lập {initiator}")
    # case_routes.py còn lọc theo các hồ sơ của trang, vốn đã kiểm tenant và người lập.
    return [task for task in found if task.get("tenantId") == tenant]


def waiting(instances: list[str], tenant: str) -> list[dict]:
    """Nhánh đang chạy của các hồ sơ `instances` (đã kiểm là của người gọi): activityId là bước đang chờ.

    Mỗi hồ sơ một truy vấn, chỉ cho hồ sơ của trang không có task: truy vấn nhánh không sắp theo khóa duy nhất
    được (sắp theo id trả 400), nên phân trang qua nhiều hồ sơ có thể chồng hay sót nhánh.
    """
    found = []
    for instance in instances:
        query = {"processInstanceId": instance, "start": 0, "size": flowable.PAGE_SIZE}
        response = flowable._call("POST", "/query/executions", json=query)
        flowable._ensure_ok(response, "đọc bước chờ")
        page = response.json()
        # Hồ sơ nhiều nhánh hơn một trang thì báo, không trả bước chờ thiếu như thể đã đủ.
        if page["total"] > len(page["data"]):
            reason = (
                f"Hồ sơ {instance} có {page['total']} nhánh đang chạy, nhiều hơn số workflow-api đọc được."
            )
            raise Denied(502, reason)
        found += [
            row
            for row in page["data"]
            if row.get("processInstanceId") == instance and row.get("tenantId") == tenant
        ]
    return found


def task_history(instance_id: str, *, complete: bool = False) -> list[dict]:
    query = {"processInstanceId": instance_id, "sort": "startTime", "order": "asc"}
    found = flowable.read_all(
        "/query/historic-task-instances", query, "đọc lịch sử bước", instance_id, complete=complete
    )
    return [row for row in found if row.get("processInstanceId") == instance_id]


def wait_history(instance_id: str, *, complete: bool = False) -> list[dict]:
    """Bước chờ (intermediateCatchEvent) đã qua và đang chờ; bỏ startEvent, sequenceFlow, gateway."""
    query = {
        "processInstanceId": instance_id,
        "activityType": "intermediateCatchEvent",
        "sort": "startTime",
        "order": "asc",
    }
    found = flowable.read_all(
        "/query/historic-activity-instances", query, "đọc lịch sử bước chờ", instance_id, complete=complete
    )
    return [
        row
        for row in found
        if row.get("processInstanceId") == instance_id and row.get("activityType") == "intermediateCatchEvent"
    ]


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
