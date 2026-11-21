# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Nhật ký câu hỏi (ADR 0021, bước 6): mỗi câu hỏi đã qua bước kiểm đầu vào một dòng trong
# platform.assistant_questions, ghi bằng vai trò CSDL `assistant` chỉ được thêm dòng. Không ghi được thì
# main.py không trả câu trả lời: câu hỏi nào cũng phải có dấu vết.

import json
import logging

import pg8000.native
from pg8000.exceptions import DatabaseError, InterfaceError

from .config import settings
from .errors import Denied
from .retrieval import Caller
from .schemas import Answer, Question

log = logging.getLogger("assistant.journal")

INSERT = """
INSERT INTO platform.assistant_questions
    (tenant_id, asked_by, app, documents, question, outcome, answer, reason, citations, model, duration_ms)
VALUES (:tenant, :sub, :app, CAST(:documents AS text[]), :question, :outcome, :answer, :reason,
    CAST(:citations AS jsonb), :model, :duration_ms)
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
        # Mảng PostgreSQL dạng chữ ({a,b}); mã văn bản đã kiểm là slug nên không cần thoát ký tự.
        "documents": "{" + ",".join(question.documents) + "}",
        "question": question.question.strip(),
        "outcome": answer.outcome if answer else "failed",
        "answer": answer.answer if answer else None,
        "reason": answer.reason if answer else failure,
        "citations": json.dumps(
            [c.model_dump() for c in answer.citations] if answer else [], ensure_ascii=False
        ),
        "model": settings.model,
        "duration_ms": duration_ms,
    }
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
        connection.close()
