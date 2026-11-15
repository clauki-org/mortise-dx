# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# API tệp của lõi, đứng sau APISIX tại /v1/files. Ứng dụng không chạm thẳng vào SeaweedFS:
# lớp này gán tenant và người tải lên từ token, giới hạn cỡ, ghi thông tin tệp vào CSDL và chỉ
# trả tệp của đúng tenant. Tệp của tenant khác trả 404, không lộ việc tệp tồn tại.

import re
import tempfile
import uuid
from typing import Annotated

from fastapi import Depends, FastAPI, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, StreamingResponse

from . import db, storage
from .auth import caller_from_token
from .config import settings
from .policy import Caller, Denied, Receiver, clean_name, content_disposition
from .schemas import ErrorBody, FileInfo

# openapi_url=None: không phục vụ tài liệu qua cổng; hợp đồng nằm trong contracts/.
app = FastAPI(title="Mortise DX files API", version="0.1.0", docs_url=None, redoc_url=None, openapi_url=None)

CallerDep = Annotated[Caller, Depends(caller_from_token)]

# Kiểu nội dung chỉ để giao diện biết tệp là gì; không khớp dạng type/subtype thì coi là nhị phân.
_MEDIA_TYPE = re.compile(r"^[\w.+-]+/[\w.+-]+$")
# Tệp nhỏ giữ trong bộ nhớ, tệp lớn hơn tràn ra đĩa tạm.
_SPOOL_BYTES = 8 * 1024 * 1024


def _errors(*codes: int) -> dict:
    return {code: {"model": ErrorBody} for code in (401, *codes)}


@app.exception_handler(Denied)
def denied(_: Request, error: Denied) -> JSONResponse:
    return JSONResponse({"error": error.reason}, status_code=error.status)


# Healthcheck của Docker, không đi qua cổng nên không thuộc hợp đồng.
@app.get("/healthz", include_in_schema=False)
def healthz() -> dict:
    return {"status": "ok"}


def _content_type(header: str | None) -> str:
    value = (header or "").split(";", 1)[0].strip().lower()
    return value if _MEDIA_TYPE.match(value) and len(value) <= 127 else "application/octet-stream"


@app.post(
    "/v1/files",
    status_code=201,
    response_model=FileInfo,
    responses=_errors(400, 403, 413, 503),
    openapi_extra={
        "requestBody": {
            "required": True,
            "description": "Nội dung tệp, gửi nguyên văn (không multipart); Content-Type là kiểu của tệp",
            "content": {"*/*": {"schema": {"type": "string", "format": "binary"}}},
        }
    },
)
async def upload(
    request: Request,
    caller: CallerDep,
    name: Annotated[str, Query(description="Tên tệp hiển thị, ví dụ bien-ban.pdf")],
) -> dict:
    display = clean_name(name)
    declared = request.headers.get("content-length", "")
    # Khai sẵn cỡ quá giới hạn thì từ chối trước khi nhận byte nào.
    if declared.isdigit() and int(declared) > settings.max_bytes:
        raise Denied(413, f"Tệp lớn quá giới hạn {settings.max_bytes // (1024 * 1024)} MB.")
    receiver = Receiver(settings.max_bytes)
    file_id = str(uuid.uuid4())
    content_type = _content_type(request.headers.get("content-type"))
    with tempfile.SpooledTemporaryFile(max_size=_SPOOL_BYTES) as buffer:
        async for chunk in request.stream():
            receiver.add(chunk)
            buffer.write(chunk)
        sha256 = receiver.finish()
        buffer.seek(0)
        await run_in_threadpool(storage.put, caller.tenant, file_id, buffer, content_type)
    record = {
        "id": file_id,
        "tenant": caller.tenant,
        "name": display,
        "content_type": content_type,
        "size": receiver.size,
        "sha256": sha256,
        "uploaded_by": caller.sub,
    }
    try:
        return await run_in_threadpool(db.insert, record)
    except Denied:
        # Không ghi được thông tin thì xóa nội dung vừa lưu, để không còn tệp không ai tra ra được.
        await run_in_threadpool(storage.delete, caller.tenant, file_id)
        raise


def _find(caller: Caller, file_id: uuid.UUID) -> dict:
    found = db.find(caller.tenant, str(file_id))
    if found is None:
        raise Denied(404, "Không tìm thấy tệp.")
    return found


@app.get("/v1/files/{file_id}", response_model=FileInfo, responses=_errors(403, 404, 503))
def info(file_id: uuid.UUID, caller: CallerDep) -> dict:
    return _find(caller, file_id)


@app.get(
    "/v1/files/{file_id}/content",
    response_class=StreamingResponse,
    responses={200: {"description": "Nội dung tệp", "content": {"*/*": {}}}, **_errors(403, 404, 503)},
)
def content(file_id: uuid.UUID, caller: CallerDep) -> StreamingResponse:
    found = _find(caller, file_id)
    body = storage.open_stream(caller.tenant, found["id"])
    return StreamingResponse(
        body.iter_chunks(),
        media_type=found["contentType"],
        headers={
            "Content-Length": str(found["size"]),
            "Content-Disposition": content_disposition(found["name"]),
            # Tệp do người dùng tải lên: trình duyệt không được đoán kiểu hay chạy nội dung của nó.
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )
