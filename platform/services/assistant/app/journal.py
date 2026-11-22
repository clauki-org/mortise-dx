# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Nhật ký câu hỏi (ADR 0021, bước 6): mỗi câu hỏi đã qua bước kiểm đầu vào một dòng trong
# platform.assistant_questions, ghi bằng vai trò CSDL `assistant` chỉ được thêm dòng. Không ghi được thì
# main.py không trả câu trả lời: câu hỏi nào cũng phải có dấu vết. Câu hỏi dữ liệu (ADR 0027) ghi câu truy vấn
# và số dòng, không ghi dòng kết quả.

import json
import logging

import pg8000.native
from pg8000.exceptions import DatabaseError, InterfaceError

from .config import settings
from .data_run import shown
from .errors import Denied
from .retrieval import Caller
from .schemas import Answer, DataAnswer, DataQuery, Question

log = logging.getLogger("assistant.journal")

INSERT = """
INSERT INTO platform.assistant_questions
    (tenant_id, asked_by, app, documents, question, outcome, answer, reason, citations, model, model_provider,
    model_host, duration_ms, query, row_count, attempts)
VALUES (:tenant, :sub, :app, CAST(:documents AS text[]), :question, :outcome, :answer, :reason,
    CAST(:citations AS jsonb), :model, :model_provider, :model_host, :duration_ms, :query, :row_count, :attempts)
"""


def _connect() -> pg8000.native.Connection:
    return pg8000.native.Connection(
        settings.db_user,
        host=settings.db_host,
        database=settings.db_name,
        password=settings.db_password,
        timeout=10,
    )


def record(
    caller: Caller, question: Question, duration_ms: int, answer: Answer | None, failure: str = ""
) -> None:
    """Ghi một câu hỏi: `answer` là câu trả lời hay lời từ chối; None kèm `failure` khi lỗi chặn trả lời."""
    params = {
        "tenant": caller.tenant,
        "sub": caller.sub,
        "app": question.app,
        # pg8000 đổi list thành mảng PostgreSQL và tự thoát ký tự trong từng phần tử.
        "documents": list(question.documents),
        "question": question.question.strip(),
        "outcome": answer.outcome if answer else "failed",
        "answer": answer.answer if answer else None,
        "reason": answer.reason if answer else failure,
        "citations": json.dumps(
            [c.model_dump() for c in answer.citations] if answer else [], ensure_ascii=False
        ),
        # Lấy từ cấu hình chứ không từ câu trả lời: dòng của câu hỏi lỗi hay từ chối không gọi mô hình
        # cũng ghi câu hỏi lẽ ra đi tới đâu, kể cả khi cấu hình sai (providers.Unconfigured).
        "model": settings.model,
        "model_provider": settings.llm_provider,
        "model_host": settings.llm_host,
        "duration_ms": duration_ms,
        "query": None,
        "row_count": None,
        "attempts": None,
    }
    _write(caller, params)


def record_data(
    caller: Caller, request: DataQuery, duration_ms: int, answer: DataAnswer | None, failure: str = ""
) -> None:
    """Ghi một câu hỏi dữ liệu: `answer` là bảng hay lời từ chối; None kèm `failure` khi lỗi chặn trả lời.

    Câu chạy từ câu mẫu không qua mô hình, nên `model` và `attempts` trống."""
    outcome = "failed"
    if answer:
        outcome = "answered" if answer.outcome == "data" else "refused"
    params = {
        "tenant": caller.tenant,
        "sub": caller.sub,
        "app": request.app,
        "documents": [],
        "question": request.question.strip(),
        "outcome": outcome,
        "answer": None,
        "reason": answer.reason if answer else failure,
        "citations": "[]",
        "model": None,
        "model_provider": None,
        "model_host": None,
        "duration_ms": duration_ms,
        "query": answer.query if answer else shown(request.query),
        "row_count": sum(len(table.rows) for table in answer.tables) if outcome == "answered" else None,
        "attempts": None,
    }
    _write(caller, params)


def _write(caller: Caller, params: dict) -> None:
    try:
        connection = _connect()
    except (InterfaceError, DatabaseError) as error:
        log.error("Không kết nối được CSDL để ghi nhật ký câu hỏi: %s", error)
        raise Denied(503, "Không ghi được nhật ký câu hỏi; báo người vận hành kiểm tra `make ps`.") from error
    try:
        # Nhật ký thay đổi (core.audit_row) đọc người làm từ mortise.actor, chỉ sống trong giao dịch hiện tại.
        connection.run("BEGIN")
        connection.run("SELECT set_config('mortise.actor', :actor, true)", actor=caller.sub)
        connection.run(INSERT, **params)
        connection.run("COMMIT")
    except (InterfaceError, DatabaseError) as error:
        log.error("CSDL từ chối ghi nhật ký câu hỏi: %s", error)
        raise Denied(
            503, "Không ghi được nhật ký câu hỏi; báo người vận hành xem log của assistant."
        ) from error
    finally:
        _close(connection)


def _close(connection: pg8000.native.Connection) -> None:
    # Lỗi khi đóng không được đè lên kết quả của lần ghi: dòng đã COMMIT thì câu trả lời vẫn trả, ghi hỏng
    # thì người hỏi vẫn nhận 503 có lý do thay vì 500.
    try:
        connection.close()
    except (InterfaceError, DatabaseError, OSError) as error:
        log.warning("Không đóng được kết nối nhật ký câu hỏi: %s", error)
