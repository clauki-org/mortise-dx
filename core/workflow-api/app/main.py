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

from . import db, delegation, flowable, sealing
from .auth import caller_from_token
from .authority import group, pick
from .case_routes import router as case_router
from .counts import router as count_router
from .policy import (
    IDEMPOTENCY_VARIABLE,
    RESERVED_PREFIX,
    Caller,
    Denied,
    TaskView,
    check_can_complete,
    check_idempotency_key,
    check_not_preset,
    check_parent_can_complete,
    check_person,
    check_start_fields,
    check_step_fields,
    check_variables,
    delegated_to,
)
from .schemas import InstanceStatus, ProcessStarted, Task, VariablesBody, error_responses

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
        "quy trình đã tạo, không tạo mới. Với tài khoản dịch vụ (ADR 0017), chỉ quy trình còn mở mới được "
        "trả lại: quy trình cũ đã kết thúc thì mã đó mở quy trình mới",
    ),
]

# Hai lần bấm gần như cùng lúc phải chạy lần lượt để lần sau thấy quy trình lần trước vừa tạo. Chia khóa
# theo băm của mã để yêu cầu của người khác không phải chờ nhau khi Flowable chậm; số khóa cố định nên không
# phình bộ nhớ. Khóa trong tiến trình chỉ đủ khi chạy một bản workflow-api; nhiều bản thì cần khóa chung.
_start_locks = tuple(threading.Lock() for _ in range(64))


@app.exception_handler(Denied)
def denied(_: Request, error: Denied) -> JSONResponse:
    return JSONResponse({"error": error.reason}, status_code=error.status)


# Mặc định FastAPI trả lỗi kiểm dữ liệu dạng {"detail": [...]} bằng tiếng Anh; mọi lỗi khác
# của API này có dạng {"error": "..."}, nên giao diện chỉ phải đọc một dạng.
@app.exception_handler(RequestValidationError)
def invalid_body(_: Request, error: RequestValidationError) -> JSONResponse:
    # Tham số trên đường dẫn sai là lỗi của yêu cầu, không phải của thân: trả 400 và nêu tham số.
    params = sorted({str(e["loc"][1]) for e in error.errors() if e["loc"][0] == "query"})
    if params:
        return JSONResponse(
            {"error": f"Tham số không hợp lệ: {', '.join(params)}. {QUERY_HINT}"}, status_code=400
        )
    extra = sorted(str(e["loc"][-1]) for e in error.errors() if e["type"] == "extra_forbidden")
    reason = f"Thân request có khóa lạ: {', '.join(extra)}. " if extra else "Thân request sai định dạng. "
    hint = 'Biến của quy trình đặt trong `variables`, ví dụ {"variables": {"approved": true}}.'
    return JSONResponse({"error": reason + hint}, status_code=422)


QUERY_HINT = (
    "state là open, ended hoặc all; offset là số nguyên không âm; limit từ 1 tới 100; process là khóa quy "
    "trình, tối đa 20 khóa."
)

app.include_router(case_router)
app.include_router(count_router)


# Healthcheck của Docker, không đi qua cổng nên không thuộc hợp đồng.
@app.get("/healthz", include_in_schema=False)
def healthz() -> dict:
    return {"status": "ok"}


@app.post(
    "/v1/workflow/processes/{key}/instances",
    status_code=201,
    response_model=ProcessStarted,
    responses=error_responses(400, 403, 404, 409, 502, 503),
)
def start_process(
    key: str,
    caller: CallerDep,
    body: VariablesIn = None,
    idempotency_key: IdempotencyKey = None,
) -> dict:
    variables = _variables_in(body)
    check_variables(variables)
    definition = flowable.definition(key, caller.tenant)
    check_not_preset(variables, definition.decisions)
    check_start_fields(variables, definition.fields)
    authorities = _authorities(key, caller.tenant, definition.authorities, variables)
    variables |= {"initiator": caller.sub, "initiatorName": caller.username, "tenant": caller.tenant}
    variables |= authorities
    if idempotency_key is None:
        started = flowable.start(key, caller.tenant, variables)["id"]
        if definition.tracked:
            sealing.after_step(started, definition, caller.sub)
        return {"id": started, "process": key}
    check_idempotency_key(idempotency_key)
    with _start_locks[hash((caller.tenant, key, caller.sub, idempotency_key)) % len(_start_locks)]:
        # Dịch vụ dùng mã cố định cho một sự việc, ví dụ một luật trên một thiết bị: còn hồ sơ mở thì không mở
        # thêm, hồ sơ đã đóng thì lần sau mở hồ sơ mới. Lọc theo initiator là sub của dịch vụ, nên người dùng
        # không chặn được việc mở hồ sơ bằng cách tự tạo quy trình mang cùng mã.
        found = flowable.started_with(
            caller.tenant, key, caller.sub, idempotency_key, open_only=caller.service
        )
        if found is None:
            found = flowable.start(key, caller.tenant, variables | {IDEMPOTENCY_VARIABLE: idempotency_key})
            # Quy trình có thể vào ngay một bước chờ hẹn giờ sau sự kiện bắt đầu.
            if definition.tracked:
                sealing.after_step(found["id"], definition, caller.sub)
    return {"id": found["id"], "process": key}


@app.get("/v1/workflow/tasks", response_model=list[Task], responses=error_responses(403, 502, 503))
def my_tasks(caller: CallerDep) -> list[dict]:
    check_person(caller)
    # Hai truy vấn vì Flowable không gộp "chưa giao, thuộc nhóm của tôi" với "đã giao cho tôi".
    found = {t["id"]: t for t in flowable.tasks(caller.tenant, groups=sorted(caller.roles))}
    found |= {t["id"]: t for t in flowable.tasks(caller.tenant, assignee=caller.sub)}
    # Bước của tenant con mà workflow-api đã gán cho nhóm tenant của người gọi lúc lập hồ sơ (ADR 0029).
    found |= {t["id"]: t for t in delegation.tasks(caller)}
    return [_task_out(t) for t in found.values()]


@app.post(
    "/v1/workflow/tasks/{task_id}/complete",
    status_code=204,
    response_class=Response,
    responses=error_responses(400, 403, 404, 409, 502, 503),
)
def complete_task(task_id: str, caller: CallerDep, body: VariablesIn = None) -> Response:
    check_person(caller)
    variables = _variables_in(body)
    check_variables(variables)
    raw = flowable.task(task_id)
    if raw is None:
        raise Denied(404, "Không tìm thấy task.")
    task = _task_view(raw)
    # Task của tenant khác chỉ được xét tiếp khi nhóm ứng viên là nhóm tenant của người gọi; chỉ khi đó mới
    # đọc CSDL, để người lạ thử mã task nhận 404 ngay cả khi CSDL lỗi (ADR 0029).
    if delegated_to(caller, task):
        check_parent_can_complete(caller, task, db.children(caller.tenant))
    else:
        check_can_complete(caller, task)
    # Kiểm sau quyền: người của tenant khác hay vai trò khác nhận 404/403 như trước, không biết được bước
    # nào có trường gì. Đường của tenant cha cũng qua đây: người duyệt của tenant cha không ghi được trường
    # của bước khác.
    definition = flowable.definition_of(raw["processDefinitionId"])
    check_step_fields(variables, definition.fields, raw["taskDefinitionKey"])
    flowable.claim_and_complete(task_id, caller.sub, variables)
    # Bước vừa xong có thể đưa hồ sơ vào bước chờ hẹn giờ hay tới kết thúc (ADR 0053).
    if definition.tracked:
        sealing.after_step(raw["processInstanceId"], definition, caller.sub)
    return Response(status_code=204)


@app.get(
    "/v1/workflow/instances/{instance_id}",
    response_model=InstanceStatus,
    responses=error_responses(403, 404, 502, 503),
)
def instance_status(instance_id: str, caller: CallerDep) -> dict:
    check_person(caller)
    found = flowable.instance(instance_id)
    if found is None or found.get("tenantId") != caller.tenant:
        raise Denied(404, "Không tìm thấy quy trình.")
    seal = sealing.status(found, flowable.definition_of(found["processDefinitionId"]))
    return {
        "id": found["id"],
        "ended": found["endTime"] is not None,
        "outcome": found.get("endActivityId"),
        "seal": seal,
    }


def _authorities(
    key: str, tenant: str, steps: frozenset[str], variables: dict[str, object]
) -> dict[str, object]:
    """Biến `authority_<bước>` của hồ sơ sắp mở, chọn theo bảng phân cấp của tenant (ADR 0028)."""
    if not steps:
        return {}
    parent, rows = db.authorities(tenant, key, steps)
    chosen = {}
    for step in sorted(steps):
        row = pick(rows.get(step, []), variables, parent)
        # Không có dòng nào thì task không có nhóm ứng viên và nằm lại mà không ai thấy; từ chối ngay để người
        # lập biết. 409 ở route hoàn thành task nghĩa là task vừa bị nhận, nên lý do phải nói rõ là bảng phân
        # cấp.
        if row is None:
            raise Denied(
                409,
                f"Tenant {tenant} chưa có bảng phân cấp thẩm quyền cho bước '{step}' của quy trình '{key}'. "
                "Người vận hành chạy lại `make app-install APP=<gói>` (quy trình mẫu: `make seed`) để nạp "
                "dòng mặc định; tenant tạo sau khi cài gói chưa có dòng nào.",
            )
        chosen[f"{RESERVED_PREFIX}{step}"] = group(row, parent)
    return chosen


def _variables_in(body: VariablesBody | None) -> dict[str, object]:
    return (body.variables if body else None) or {}


def _variables(raw: dict) -> dict[str, object]:
    return {v["name"]: v.get("value") for v in raw.get("variables", [])}


def _task_view(raw: dict) -> TaskView:
    variables = _variables(raw)
    return TaskView(
        tenant=raw.get("tenantId") or "",
        assignee=raw.get("assignee"),
        candidate_groups=flowable.candidate_groups(raw["id"]),
        category=raw.get("category"),
        initiator=variables.get("initiator"),
        # Biến chỉ lõi đặt được (check_variables), nên có biến là bước này lấy vai trò từ bảng phân cấp.
        authority=f"{RESERVED_PREFIX}{raw.get('taskDefinitionKey')}" in variables,
    )


def _task_out(raw: dict) -> dict:
    return {
        "id": raw["id"],
        "name": raw["name"],
        # tenantId của Flowable, không phải biến `tenant`: biến chỉ là bản ghi lúc khởi tạo.
        "tenant": raw.get("tenantId") or "",
        "step": raw["taskDefinitionKey"],
        "process": flowable.process_key(raw["processDefinitionId"]),
        "due": raw.get("dueDate"),
        "category": raw.get("category"),
        "processInstanceId": raw["processInstanceId"],
        "created": raw["createTime"],
        "assignee": raw.get("assignee"),
        "variables": _variables(raw),
    }
