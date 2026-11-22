# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Trợ lý (ADR 0021, ADR 0027), đứng sau APISIX tại /v1/assistant. Hai đường: hỏi văn bản, nhận câu trả lời
# kèm câu trích đã kiểm hoặc lời từ chối có lý do (pipeline.py), mô hình là Ollama ở profile `ai` hay một API
# tương thích OpenAI theo cấu hình (providers.py); hỏi dữ liệu, chạy một câu GraphQL chỉ đọc đã qua guard bằng
# token người hỏi và nhận bảng kèm câu đã chạy (data_run.py). Đường thứ hai không cần mô hình.

import logging
import time
from typing import Annotated

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from . import data_run, journal
from .auth import caller_from_token
from .config import settings
from .errors import Denied
from .model import Model
from .pipeline import ask
from .providers import configured
from .retrieval import Caller
from .schemas import Answer, DataAnswer, DataQuery, ErrorBody, Question

# openapi_url=None: không phục vụ tài liệu qua cổng; hợp đồng nằm trong contracts/.
app = FastAPI(
    title="Mortise DX assistant API", version="0.1.0", docs_url=None, redoc_url=None, openapi_url=None
)
# Chọn lúc import để cấu hình sai hiện trong log ngay khi container khởi động, không đợi câu hỏi đầu tiên.
_model = configured()
log = logging.getLogger("assistant")


def model() -> Model:
    return _model


CallerDep = Annotated[Caller, Depends(caller_from_token)]
ModelDep = Annotated[Model, Depends(model)]


@app.exception_handler(Denied)
def denied(_: Request, error: Denied) -> JSONResponse:
    return JSONResponse({"error": error.reason}, status_code=error.status)


# Thân yêu cầu sai dạng trả 400 kèm lý do ngắn, cùng dạng {"error": "..."} như mọi lỗi khác.
@app.exception_handler(RequestValidationError)
def invalid(_: Request, error: RequestValidationError) -> JSONResponse:
    first = error.errors()[0]
    where = ".".join(str(part) for part in first["loc"][1:]) or "thân yêu cầu"
    return JSONResponse({"error": f"Yêu cầu không hợp lệ ở {where}: {first['msg']}."}, status_code=400)


@app.exception_handler(HTTPException)
def http_error(_: Request, error: HTTPException) -> JSONResponse:
    reasons = {404: "Không có đường này.", 405: "Đường này chỉ nhận POST."}
    return JSONResponse(
        {"error": reasons.get(error.status_code, error.detail)}, status_code=error.status_code
    )


# Healthcheck của Docker, không đi qua cổng nên không thuộc hợp đồng.
@app.get("/healthz", include_in_schema=False)
def healthz() -> dict:
    return {"status": "ok"}


@app.post(
    "/v1/assistant/questions",
    response_model=Answer,
    responses={code: {"model": ErrorBody} for code in (400, 401, 403, 500, 502, 503, 504)},
)
def questions(question: Question, caller: CallerDep, chosen: ModelDep) -> Answer:
    """Trả lời từ các văn bản được hỏi, chỉ trong các đoạn mà token người hỏi đọc được.

    Không đủ căn cứ hay câu trả lời không qua bước kiểm thì `outcome` là `refused` kèm lý do (mã 200). Mỗi câu
    hỏi được ghi nhật ký; không ghi được thì trả 503 thay cho câu trả lời.
    """
    started = time.monotonic()
    try:
        answer = ask(caller, question, chosen)
    except Denied as error:
        # Lỗi đầu vào (4xx) không phải câu hỏi đã được xử lý; lỗi phía máy chủ thì có, và phải để lại dấu vết.
        if error.status >= 500:
            journal.record(caller, question, _elapsed(started), None, error.reason)
        raise
    except Exception as error:
        # Lỗi không lường trước cũng phải có dòng nhật ký, như docs/api.md hứa. Chi tiết chỉ vào log của
        # dịch vụ: nội dung lỗi có thể chứa dữ liệu nội bộ, không đưa vào nhật ký hay vào phản hồi.
        log.exception("Lỗi không lường trước khi trả lời câu hỏi")
        reason = "Trợ lý gặp lỗi không lường trước; báo người vận hành xem log của assistant."
        journal.record(caller, question, _elapsed(started), None, reason)
        raise Denied(500, reason) from error
    journal.record(caller, question, _elapsed(started), answer)
    return answer


@app.post(
    "/v1/assistant/data-queries",
    response_model=DataAnswer,
    responses={code: {"model": ErrorBody} for code in (400, 401, 403, 404, 500, 502, 503)},
)
def data_queries(request: DataQuery, caller: CallerDep) -> DataAnswer:
    """Chạy một câu GraphQL chỉ đọc trên các bảng mà mục menu `item` của gói `app` khai, bằng token người hỏi.

    Câu không qua guard hay bị Hasura từ chối thì `outcome` là `refused` kèm lý do và câu bị từ chối (mã
    200). Mục menu không có trong tenant của token, hay không hỏi dữ liệu, là 404. Mỗi câu được ghi nhật ký
    kèm câu truy vấn và số dòng, không kèm dòng; không ghi được thì trả 503 thay cho bảng.
    """
    started = time.monotonic()
    text = request.question.strip()
    if not text:
        raise Denied(400, "Câu hỏi trống.")
    if len(text) > settings.max_question_chars:
        raise Denied(400, f"Câu hỏi dài quá {settings.max_question_chars} ký tự; hỏi ngắn hơn.")
    try:
        answer = data_run.answer(caller, request, data_run.data_config(caller, request.app, request.item))
    except Denied as error:
        if error.status >= 500:
            journal.record_data(caller, request, _elapsed(started), None, error.reason)
        raise
    except Exception as error:
        log.exception("Lỗi không lường trước khi chạy câu hỏi dữ liệu")
        reason = "Trợ lý gặp lỗi không lường trước; báo người vận hành xem log của assistant."
        journal.record_data(caller, request, _elapsed(started), None, reason)
        raise Denied(500, reason) from error
    journal.record_data(caller, request, _elapsed(started), answer)
    return answer


def _elapsed(started: float) -> int:
    return round((time.monotonic() - started) * 1000)
