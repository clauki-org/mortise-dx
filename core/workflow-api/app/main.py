# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# API quy trình của lõi, đứng sau APISIX. Flowable chỉ nhận lệnh từ đây bằng tài khoản
# kỹ thuật, nên mọi kiểm tra tenant, vai trò và quy tắc bốn mắt nằm ở lớp này.

from typing import Annotated

from fastapi import Body, Depends, FastAPI, Request
from fastapi.responses import JSONResponse, Response

from . import flowable
from .auth import caller_from_token
from .policy import Caller, Denied, TaskView, check_can_complete, check_variables

app = FastAPI(title="DX-OS workflow API", docs_url=None, redoc_url=None, openapi_url=None)

CallerDep = Annotated[Caller, Depends(caller_from_token)]
# Thân request dạng {"variables": {...}}; bỏ trống thì coi như không có biến.
Variables = Annotated[dict[str, object] | None, Body(embed=True)]


@app.exception_handler(Denied)
def denied(_: Request, error: Denied) -> JSONResponse:
    return JSONResponse({"error": error.reason}, status_code=error.status)


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@app.post("/v1/workflow/processes/{key}/instances", status_code=201)
def start_process(key: str, caller: CallerDep, variables: Variables = None) -> dict:
    variables = variables or {}
    check_variables(variables)
    started = flowable.start(
        key,
        caller.tenant,
        variables | {"initiator": caller.sub, "initiatorName": caller.username, "tenant": caller.tenant},
    )
    return {"id": started["id"], "process": key}


@app.get("/v1/workflow/tasks")
def my_tasks(caller: CallerDep) -> list[dict]:
    # Hai truy vấn vì Flowable không gộp "chưa giao, thuộc nhóm của tôi" với "đã giao cho tôi".
    found = {t["id"]: t for t in flowable.tasks(caller.tenant, groups=sorted(caller.roles))}
    found |= {t["id"]: t for t in flowable.tasks(caller.tenant, assignee=caller.sub)}
    return [_task_out(t) for t in found.values()]


@app.post("/v1/workflow/tasks/{task_id}/complete", status_code=204)
def complete_task(task_id: str, caller: CallerDep, variables: Variables = None) -> Response:
    variables = variables or {}
    check_variables(variables)
    raw = flowable.task(task_id)
    if raw is None:
        raise Denied(404, "Không tìm thấy task.")
    check_can_complete(caller, _task_view(raw))
    flowable.claim_and_complete(task_id, caller.sub, variables)
    return Response(status_code=204)


@app.get("/v1/workflow/instances/{instance_id}")
def instance_status(instance_id: str, caller: CallerDep) -> dict:
    found = flowable.instance(instance_id)
    if found is None or found.get("tenantId") != caller.tenant:
        raise Denied(404, "Không tìm thấy quy trình.")
    return {"id": found["id"], "ended": found["endTime"] is not None, "outcome": found.get("endActivityId")}


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
        "category": raw.get("category"),
        "processInstanceId": raw["processInstanceId"],
        "created": raw["createTime"],
        "assignee": raw.get("assignee"),
        "variables": _variables(raw),
    }
