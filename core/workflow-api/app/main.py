# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# API quy trình của lõi, đứng sau APISIX. Flowable chỉ nhận lệnh từ đây bằng tài khoản
# kỹ thuật, nên mọi kiểm tra tenant, vai trò và quy tắc bốn mắt nằm ở lớp này.

import threading
from typing import Annotated

from fastapi import Body, Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response

from . import flowable
from .auth import caller_from_token
from .policy import (
    IDEMPOTENCY_VARIABLE,
    Caller,
    Denied,
    TaskView,
    check_can_complete,
    check_idempotency_key,
    check_variables,
)
from .schemas import ErrorBody, InstanceStatus, ProcessStarted, Task, VariablesBody

# openapi_url=None: không phục vụ tài liệu qua cổng; hợp đồng nằm trong contracts/.
app = FastAPI(
    title="Mortise DX workflow API", version="0.1.0", docs_url=None, redoc_url=None, openapi_url=None
)

CallerDep = Annotated[Caller, Depends(caller_from_token)]
# Thân request dạng {"variables": {...}}; không gửi thân thì coi như không có biến.
VariablesIn = Annotated[VariablesBody | None, Body()]
IdempotencyKey = Annotated[
    str | None,
    Header(
        alias="Idempotency-Key",
        description="Mã ngẫu nhiên của lần gửi; cùng người gửi lại cùng mã cho cùng quy trình thì nhận "
        "quy trình đã tạo, không tạo mới",
    ),
]

# Hai lần bấm gần như cùng lúc phải chạy lần lượt để lần sau thấy quy trình lần trước vừa tạo. Chia khóa
# theo băm của mã để yêu cầu của người khác không phải chờ nhau khi Flowable chậm; số khóa cố định nên không
# phình bộ nhớ. Khóa trong tiến trình chỉ đủ khi chạy một bản workflow-api; nhiều bản thì cần khóa chung.
_start_locks = tuple(threading.Lock() for _ in range(64))


# 401 và 422 khai cho mọi route: route nào cũng kiểm token, và FastAPI tự ghi 422 theo dạng
# mặc định của nó vào OpenAPI nếu route không khai, lệch với dạng {"error": "..."} thật sự trả về.
def _errors(*codes: int) -> dict:
    return {code: {"model": ErrorBody} for code in (401, 422, *codes)}


@app.exception_handler(Denied)
def denied(_: Request, error: Denied) -> JSONResponse:
    return JSONResponse({"error": error.reason}, status_code=error.status)


# Mặc định FastAPI trả lỗi kiểm dữ liệu dạng {"detail": [...]} bằng tiếng Anh; mọi lỗi khác
# của API này có dạng {"error": "..."}, nên giao diện chỉ phải đọc một dạng.
@app.exception_handler(RequestValidationError)
def invalid_body(_: Request, error: RequestValidationError) -> JSONResponse:
    extra = sorted(str(e["loc"][-1]) for e in error.errors() if e["type"] == "extra_forbidden")
    reason = f"Thân request có khóa lạ: {', '.join(extra)}. " if extra else "Thân request sai định dạng. "
    hint = 'Biến của quy trình đặt trong `variables`, ví dụ {"variables": {"approved": true}}.'
    return JSONResponse({"error": reason + hint}, status_code=422)


# Healthcheck của Docker, không đi qua cổng nên không thuộc hợp đồng.
@app.get("/healthz", include_in_schema=False)
def healthz() -> dict:
    return {"status": "ok"}


@app.post(
    "/v1/workflow/processes/{key}/instances",
    status_code=201,
    response_model=ProcessStarted,
    responses=_errors(400, 403, 404, 502, 503),
)
def start_process(
    key: str,
    caller: CallerDep,
    body: VariablesIn = None,
    idempotency_key: IdempotencyKey = None,
) -> dict:
    variables = _variables_in(body)
    check_variables(variables)
    variables |= {"initiator": caller.sub, "initiatorName": caller.username, "tenant": caller.tenant}
    if idempotency_key is None:
        return {"id": flowable.start(key, caller.tenant, variables)["id"], "process": key}
    check_idempotency_key(idempotency_key)
    with _start_locks[hash((caller.tenant, key, caller.sub, idempotency_key)) % len(_start_locks)]:
        found = flowable.started_with(caller.tenant, key, caller.sub, idempotency_key)
        if found is None:
            found = flowable.start(key, caller.tenant, variables | {IDEMPOTENCY_VARIABLE: idempotency_key})
    return {"id": found["id"], "process": key}


@app.get("/v1/workflow/tasks", response_model=list[Task], responses=_errors(403, 502, 503))
def my_tasks(caller: CallerDep) -> list[dict]:
    # Hai truy vấn vì Flowable không gộp "chưa giao, thuộc nhóm của tôi" với "đã giao cho tôi".
    found = {t["id"]: t for t in flowable.tasks(caller.tenant, groups=sorted(caller.roles))}
    found |= {t["id"]: t for t in flowable.tasks(caller.tenant, assignee=caller.sub)}
    return [_task_out(t) for t in found.values()]


@app.post(
    "/v1/workflow/tasks/{task_id}/complete",
    status_code=204,
    response_class=Response,
    responses=_errors(400, 403, 404, 409, 502, 503),
)
def complete_task(task_id: str, caller: CallerDep, body: VariablesIn = None) -> Response:
    variables = _variables_in(body)
    check_variables(variables)
    raw = flowable.task(task_id)
    if raw is None:
        raise Denied(404, "Không tìm thấy task.")
    check_can_complete(caller, _task_view(raw))
    flowable.claim_and_complete(task_id, caller.sub, variables)
    return Response(status_code=204)


@app.get(
    "/v1/workflow/instances/{instance_id}",
    response_model=InstanceStatus,
    responses=_errors(403, 404, 502, 503),
)
def instance_status(instance_id: str, caller: CallerDep) -> dict:
    found = flowable.instance(instance_id)
    if found is None or found.get("tenantId") != caller.tenant:
        raise Denied(404, "Không tìm thấy quy trình.")
    return {"id": found["id"], "ended": found["endTime"] is not None, "outcome": found.get("endActivityId")}


def _variables_in(body: VariablesBody | None) -> dict[str, object]:
    return (body.variables if body else None) or {}


def _variables(raw: dict) -> dict[str, object]:
    return {v["name"]: v.get("value") for v in raw.get("variables", [])}


def _task_view(raw: dict) -> TaskView:
    return TaskView(
        tenant=raw.get("tenantId") or "",
        assignee=raw.get("assignee"),
        candidate_groups=flowable.candidate_groups(raw["id"]),
        category=raw.get("category"),
        initiator=_variables(raw).get("initiator"),
    )


def _task_out(raw: dict) -> dict:
    return {
        "id": raw["id"],
        "name": raw["name"],
        "step": raw["taskDefinitionKey"],
        "process": flowable.process_key(raw["processDefinitionId"]),
        "due": raw.get("dueDate"),
        "category": raw.get("category"),
        "processInstanceId": raw["processInstanceId"],
        "created": raw["createTime"],
        "assignee": raw.get("assignee"),
        "variables": _variables(raw),
    }
