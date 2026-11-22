# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Trợ lý hỏi văn bản (ADR 0021), đứng sau APISIX tại /v1/assistant, chạy trong profile `ai` cùng Ollama. Một
# đường: gửi câu hỏi, nhận câu trả lời kèm câu trích đã kiểm hoặc lời từ chối có lý do (pipeline.py).

import logging
import time
from typing import Annotated

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from . import journal
from .auth import caller_from_token
from .errors import Denied
from .model import Model, Ollama
from .pipeline import ask
from .retrieval import Caller
from .schemas import Answer, ErrorBody, Question

# openapi_url=None: không phục vụ tài liệu qua cổng; hợp đồng nằm trong contracts/.
app = FastAPI(
    title="Mortise DX assistant API", version="0.1.0", docs_url=None, redoc_url=None, openapi_url=None
)
_ollama = Ollama()
log = logging.getLogger("assistant")


def model() -> Model:
    return _ollama


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


def _elapsed(started: float) -> int:
    return round((time.monotonic() - started) * 1000)
