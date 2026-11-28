# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Route cho người lập theo dõi hồ sơ của mình (ADR 0032): danh sách hồ sơ do người gọi lập trong tenant của
# họ, và một hồ sơ với các bước đã qua. Tách khỏi GET /v1/workflow/instances/{id}, vốn trả trạng thái cho mọi
# người trong tenant: ở đây chỉ người lập thấy, và chỉ thấy biến không thuộc bước nào. main.py gắn router này
# vào ứng dụng.

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import StringConstraints

from . import flowable, history, sealing
from .auth import caller_from_token
from .cases import STATES, current_of, summary, timeline
from .policy import Caller, Denied, check_person, visible_variables
from .schemas import CaseDetail, CaseList, error_responses

router = APIRouter()

CallerDep = Annotated[Caller, Depends(caller_from_token)]
# Khóa quy trình là id của <process> trong BPMN; mẫu chặn chuỗi lạ trước khi gửi sang Flowable.
ProcessKey = Annotated[str, StringConstraints(pattern=r"^[A-Za-z_][A-Za-z0-9_.-]{0,254}$")]
# Tên biến lọc hồ sơ theo luật tên biến của contracts/workflow.schema.json.
VariableName = Annotated[str, StringConstraints(pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")]
# Mọi lý do không thấy hồ sơ (không tồn tại, của tenant khác, của người khác) cùng một câu và cùng mã, để mã
# hồ sơ đoán được không cho biết hồ sơ có tồn tại hay không.
NOT_FOUND = "Không tìm thấy hồ sơ."
# Số bước người làm gần nhất có nhóm ứng viên trên màn hình một hồ sơ; bước cũ hơn có `groups` rỗng.
GROUP_LIMIT = 50


@router.get("/v1/workflow/cases", response_model=CaseList, responses=error_responses(403, 502, 503))
def my_cases(
    caller: CallerDep,
    process: Annotated[
        list[ProcessKey] | None,
        Query(max_length=20, description="Chỉ hồ sơ của các quy trình này; bỏ trống là mọi quy trình"),
    ] = None,
    state: Annotated[
        Literal["open", "ended", "all"], Query(description="Hồ sơ còn mở, đã kết thúc hay cả hai")
    ] = "all",
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    variable_name: Annotated[
        VariableName | None,
        Query(description="Chỉ hồ sơ có biến này bằng variable_value; cần process (ADR 0068)"),
    ] = None,
    variable_value: Annotated[str | None, Query(min_length=1, max_length=200)] = None,
) -> dict:
    """Hồ sơ do người gọi lập trong tenant của mình, mới nhất trước, kèm bước đang chờ."""
    check_person(caller)
    variable = _variable_filter(caller, process or [], variable_name, variable_value)
    total, raws = history.cases(
        caller.tenant, caller.sub, process or [], STATES[state], offset, limit, variable
    )
    definitions = {raw["id"]: flowable.definition_of(raw["processDefinitionId"]) for raw in raws}
    current = _current(caller, raws, definitions)
    items = [
        summary(
            raw,
            flowable.process_key(raw["processDefinitionId"]),
            definitions[raw["id"]],
            current.get(raw["id"], []),
        )
        for raw in raws
    ]
    return {"total": total, "items": items}


def _variable_filter(
    caller: Caller, processes: list[str], name: str | None, value: str | None
) -> tuple[str, str] | None:
    """Biến lọc hồ sơ, chỉ trong các biến người lập được thấy (policy.visible_variables).

    Lọc theo biến của bước (ý kiến, quyết định) hay biến lõi đặt thì số hồ sơ khớp cho người lập đoán được
    giá trị mà họ không được xem, nên bị từ chối theo đúng luật ẩn biến của danh sách. Trường của bước đọc
    từ phiên bản mới nhất của từng quy trình; vì vậy cần process.
    """
    if name is None and value is None:
        return None
    if name is None or value is None:
        raise Denied(400, "Tham số không hợp lệ: variable_name và variable_value phải đi cùng nhau.")
    if not processes:
        raise Denied(400, "Tham số không hợp lệ: variable_name cần ít nhất một process.")
    # Không định nghĩa nào vẫn xét biến lõi đặt: định nghĩa rỗng chỉ còn luật đó.
    definitions = [flowable.Definition(decisions=frozenset(), authorities=frozenset())]
    for key in processes:
        try:
            definitions.append(flowable.definition(key, caller.tenant))
        except Denied as error:
            # Tenant chưa có quy trình này thì không có hồ sơ nào của nó để lộ; trả như khi không lọc.
            if error.status != 404:
                raise
    for definition in definitions:
        has_steps = any(kind == "task" for kind, _ in definition.nodes.values())
        if name not in visible_variables({name: value}, definition.fields, has_steps):
            raise Denied(
                400, f"Tham số không hợp lệ: variable_name '{name}' không phải biến người lập được xem."
            )
    return name, value


@router.get(
    "/v1/workflow/cases/{instance_id}",
    response_model=CaseDetail,
    responses=error_responses(403, 404, 502, 503),
)
def my_case(instance_id: str, caller: CallerDep) -> dict:
    """Một hồ sơ do người gọi lập, với các bước đã qua và đang chờ."""
    check_person(caller)
    raw = history.case(instance_id, caller.tenant, caller.sub)
    if raw is None:
        raise Denied(404, NOT_FOUND)
    definition = flowable.definition_of(raw["processDefinitionId"])
    tasks = history.task_history(instance_id)
    # Mỗi bước một lời gọi đọc nhóm; hồ sơ lặp một bước rất nhiều lần thì chỉ đọc nhóm của các bước gần nhất.
    groups = {task["id"]: history.groups_of(task) for task in tasks[-GROUP_LIMIT:]}
    deleted = raw.get("deleteReason") is not None
    steps = timeline(tasks, history.wait_history(instance_id), groups, deleted=deleted)
    current = [
        {"step": s["step"], "name": s["name"], "due": s["due"]} for s in steps if s["status"] == "open"
    ]
    process = flowable.process_key(raw["processDefinitionId"])
    seal = sealing.status(raw, definition)
    return summary(raw, process, definition, current) | {"steps": steps, "seal": seal}


def _current(
    caller: Caller, raws: list[dict], definitions: dict[str, flowable.Definition]
) -> dict[str, list[dict]]:
    """Bước đang chờ của các hồ sơ còn mở trên trang: một truy vấn task cho cả trang."""
    nodes = {raw["id"]: definitions[raw["id"]].nodes for raw in raws if raw.get("endTime") is None}
    if not nodes:
        return {}
    tasks = history.open_tasks(caller.tenant, caller.sub)
    with_task = {task["processInstanceId"] for task in tasks}
    # Hồ sơ đang ở bước chờ (hẹn giờ) thì không có task; chỉ khi đó mới hỏi nhánh đang chạy.
    waiting = [
        instance
        for instance, found in nodes.items()
        if instance not in with_task and any(kind == "wait" for kind, _ in found.values())
    ]
    executions = history.waiting(waiting, caller.tenant) if waiting else []
    return current_of(tasks, executions, nodes)
