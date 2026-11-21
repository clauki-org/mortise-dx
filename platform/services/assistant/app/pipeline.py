# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Đường ống cố định của ADR 0021: kiểm đầu vào, tìm, phân loại bằng điểm tìm, sinh, kiểm, trả. Thứ tự không
# đổi theo câu hỏi và mô hình không gọi công cụ nào, để mọi câu trả lời đi qua cùng các bước kiểm.

import threading

from . import retrieval
from .config import settings
from .errors import Denied
from .model import Model
from .retrieval import Caller
from .schemas import Answer, Citation, Question
from .verify import Unverified, check

# Một lượt sinh mỗi lúc: mô hình chạy trên CPU, lượt thứ hai chạy song song chỉ làm cả hai chậm hơn (ADR
# 0021).
_generating = threading.Lock()

NO_EVIDENCE = "Không tìm thấy đoạn nào trong các văn bản được hỏi đủ gần câu hỏi; trợ lý không trả lời."
DECLINED = "Các đoạn tìm được không đủ để trả lời câu hỏi này."


def refuse(reason: str) -> Answer:
    return Answer(outcome="refused", answer=None, reason=reason, citations=[])


def ask(caller: Caller, question: Question, model: Model) -> Answer:
    text = question.question.strip()
    if not text:
        raise Denied(400, "Câu hỏi trống.")
    if len(text) > settings.max_question_chars:
        raise Denied(400, f"Câu hỏi dài quá {settings.max_question_chars} ký tự; hỏi ngắn hơn.")
    passages = retrieval.fetch(caller, question.app, question.documents)
    sentences = retrieval.evidence(text, passages)
    if not sentences:
        return refuse(NO_EVIDENCE)
    if not _generating.acquire(blocking=False):
        raise Denied(503, "Trợ lý đang trả lời một câu hỏi khác; thử lại sau ít phút.")
    try:
        reply = model.generate(text, sentences)
    finally:
        _generating.release()
    if not reply["answerable"]:
        return refuse(DECLINED)
    try:
        cited = check(reply, sentences)
    except Unverified as problem:
        return refuse(f"Câu trả lời không qua bước kiểm: {problem}")
    citations = [
        Citation(
            document_id=s.passage.document_id,
            title=s.passage.title,
            passage_id=s.passage.passage_id,
            label=s.passage.label,
            sentence=s.text,
        )
        for s in cited
    ]
    return Answer(outcome="answered", answer=reply["answer"].strip(), reason=None, citations=citations)
