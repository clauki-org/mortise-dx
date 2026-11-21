# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# API đọc dữ liệu thiết bị của lõi, đứng sau APISIX tại /v1/context (ADR 0012). Scorpio giữ trạng
# thái thiết bị theo chuẩn NGSI-LD nhưng không tự xác thực; lớp này kiểm token, gắn tenant của người
# gọi và chỉ mở ba đường đọc: danh sách entity, một entity, lịch sử số đo của một entity. Ghi dữ liệu không đi
# qua đây mà qua MQTT (core/iot-bridge).

from typing import Annotated

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from . import scorpio
from .auth import caller_from_token
from .policy import Caller, Denied, check_entity_id, clean_history, clean_query
from .schemas import Entity, ErrorBody

# openapi_url=None: không phục vụ tài liệu qua cổng; hợp đồng nằm trong contracts/.
app = FastAPI(
    title="Mortise DX context API", version="0.1.0", docs_url=None, redoc_url=None, openapi_url=None
)

CallerDep = Annotated[Caller, Depends(caller_from_token)]


# 401 khai cho mọi route để OpenAPI đúng dạng {"error": "..."} thật sự trả về. Không khai 422: các route
# không có tham số nào để FastAPI kiểm kiểu; tham số truy vấn do policy.py kiểm và trả 400.
def _errors(*codes: int) -> dict:
    return {code: {"model": ErrorBody} for code in (401, *codes)}


@app.exception_handler(Denied)
def denied(_: Request, error: Denied) -> JSONResponse:
    return JSONResponse({"error": error.reason}, status_code=error.status)


# Đường không có (404) hay sai phương thức (405) cũng trả {"error": "..."} thay cho dạng mặc định
# {"detail": "..."} của FastAPI.
@app.exception_handler(HTTPException)
def http_error(_: Request, error: HTTPException) -> JSONResponse:
    reasons = {404: "Không có đường này.", 405: "Đường này chỉ cho đọc (GET)."}
    reason = reasons.get(error.status_code, error.detail)
    return JSONResponse({"error": reason}, status_code=error.status_code)


# Healthcheck của Docker, không đi qua cổng nên không thuộc hợp đồng.
@app.get("/healthz", include_in_schema=False)
def healthz() -> dict:
    return {"status": "ok"}


@app.get("/v1/context/entities", response_model=list[Entity], responses=_errors(400, 403, 502, 503))
def list_entities(request: Request, caller: CallerDep) -> list[dict]:
    """Entity của tenant mình; tham số type, id, idPattern, attrs, q, limit, offset theo NGSI-LD."""
    return scorpio.entities(caller.tenant, clean_query(list(request.query_params.multi_items())))


@app.get(
    "/v1/context/entities/{entity_id}", response_model=Entity, responses=_errors(400, 403, 404, 502, 503)
)
def get_entity(entity_id: str, caller: CallerDep) -> dict:
    check_entity_id(entity_id)
    return scorpio.entity(caller.tenant, entity_id)


@app.get(
    "/v1/context/temporal/entities/{entity_id}",
    response_model=Entity,
    responses=_errors(400, 403, 404, 502, 503),
)
def get_history(entity_id: str, request: Request, caller: CallerDep) -> dict:
    """Lịch sử số đo của một entity theo API temporal của NGSI-LD; tham số attrs và lastN bắt buộc.

    Mỗi số đo là danh sách các lần đo (value, observedAt), mới nhất trước; chỉ một lần đo thì là một đối
    tượng.
    """
    check_entity_id(entity_id)
    return scorpio.history(caller.tenant, entity_id, clean_history(list(request.query_params.multi_items())))
