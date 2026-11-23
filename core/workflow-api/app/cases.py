# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Dựng hồ sơ người lập thấy (ADR 0032) từ dữ liệu Flowable đã đọc: tóm tắt, bước đang chờ, dòng thời gian các
# bước. Hàm thuần, không gọi mạng; case_routes.py đọc qua history.py rồi gọi các hàm ở đây. Không trả mã hay
# tên của người xử lý: chỉ nhóm ứng viên và việc bước đã có người nhận hay chưa.

from collections.abc import Mapping

from .flowable import Definition
from .policy import visible_variables

# Lọc theo trạng thái hồ sơ -> giá trị `finished` của truy vấn lịch sử; None là không lọc.
STATES: Mapping[str, bool | None] = {"open": False, "ended": True, "all": None}


def summary(raw: dict, process: str, definition: Definition, current: list[dict]) -> dict:
    """Tóm tắt một hồ sơ từ historic process instance kèm biến."""
    variables = {v["name"]: v.get("value") for v in raw.get("variables", [])}
    outcome = raw.get("endActivityId")
    has_steps = any(kind == "task" for kind, _ in definition.nodes.values())
    return {
        "id": raw["id"],
        "process": process,
        "started": raw["startTime"],
        "ended": raw.get("endTime"),
        "outcome": outcome,
        "outcomeName": definition.nodes.get(outcome, ("end", outcome))[1] if outcome else None,
        "current": current,
        "variables": visible_variables(variables, definition.fields, has_steps),
    }


def current_of(
    tasks: list[dict], executions: list[dict], nodes: Mapping[str, Mapping[str, tuple[str, str]]]
) -> dict[str, list[dict]]:
    """Mã hồ sơ -> bước đang chờ, cho các hồ sơ trong `nodes` (hồ sơ còn mở của trang đang trả).

    `tasks` và `executions` là của mọi hồ sơ còn mở của người lập; dòng của hồ sơ ngoài trang bị bỏ. Nhánh
    đang chạy chỉ được tính khi nó đứng ở bước chờ của BPMN: nhánh gốc, nhánh ở userTask thì không.
    """
    found: dict[str, list[dict]] = {}
    for task in tasks:
        instance = task["processInstanceId"]
        if instance in nodes:
            key = task["taskDefinitionKey"]
            step = {"step": key, "name": task.get("name") or key, "due": task.get("dueDate")}
            found.setdefault(instance, []).append(step)
    for execution in executions:
        instance, activity = execution["processInstanceId"], execution.get("activityId")
        kind, name = nodes.get(instance, {}).get(activity or "", ("", ""))
        if kind == "wait":
            found.setdefault(instance, []).append({"step": activity, "name": name, "due": None})
    return found


def timeline(
    tasks: list[dict], waits: list[dict], groups: Mapping[str, frozenset[str]], *, deleted: bool = False
) -> list[dict]:
    """Bước người làm (historic task) và bước chờ (historic activity) của một hồ sơ, theo lúc bắt đầu.

    `deleted`: hồ sơ bị xóa giữa chừng (có deleteReason).
    """
    steps = [
        {
            "step": task["taskDefinitionKey"],
            "name": task.get("name") or task["taskDefinitionKey"],
            "kind": "task",
            "started": task["startTime"],
            "ended": task.get("endTime"),
            "due": task.get("dueDate"),
            "status": _status(task),
            "groups": sorted(groups.get(task["id"], ())),
            "claimed": task.get("assignee") is not None,
        }
        for task in tasks
    ]
    steps += [
        {
            "step": wait["activityId"],
            "name": wait.get("activityName") or wait["activityId"],
            "kind": "wait",
            "started": wait["startTime"],
            "ended": wait.get("endTime"),
            "due": None,
            "status": _status(wait),
            "groups": [],
            "claimed": False,
        }
        for wait in waits
    ]
    # Flowable ghi mọi thời điểm cùng một dạng ISO 8601 UTC, nên so chuỗi là so thời gian.
    steps.sort(key=lambda step: step["started"])
    # Lịch sử bước chờ không ghi deleteReason: bước chờ còn mở lúc hồ sơ bị xóa trông như đã xong. Không bước
    # nào bắt đầu từ lúc nó kết thúc trở đi nghĩa là hồ sơ dừng ngay ở đó.
    if deleted:
        for step in steps:
            later = any(other["started"] >= step["ended"] for other in steps if other is not step)
            if step["kind"] == "wait" and step["status"] == "done" and not later:
                step["status"] = "cancelled"
    return steps


def _status(row: dict) -> str:
    # Bước dừng mà không ai hoàn thành (sự kiện biên hết hạn, hồ sơ bị xóa) có deleteReason; bước hoàn thành
    # thì không.
    if row.get("endTime") is None:
        return "open"
    return "cancelled" if row.get("deleteReason") else "done"
