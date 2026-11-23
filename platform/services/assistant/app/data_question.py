# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Câu hỏi dữ liệu gõ tự do (ADR 0034): mô hình viết một câu GraphQL chỉ đọc từ câu hỏi và mô tả bảng, cột của
# mục menu (data_model.py); câu đó qua guard (guard.py); bị từ chối thì mô hình được sửa một lần theo lý do
# của guard; câu qua guard chạy qua Hasura bằng token người hỏi như câu mẫu (data_run.py). Thứ tự cố định: mọi
# lời gọi mô hình xong trước khi chạy câu, và không gọi mô hình sau khi Hasura trả, nên mô hình không bao giờ
# thấy dòng dữ liệu. Hai lời gọi mô hình chung một hạn (ASSISTANT_TIMEOUT_SECONDS), giữ lượt sinh dùng chung
# với hỏi văn bản, và nhả lượt trước khi gọi Hasura.

import logging
import time
from dataclasses import dataclass

from . import data_model, data_run, guard
from .config import settings
from .errors import Denied
from .model import Model, one_turn
from .retrieval import Caller
from .schemas import DataAnswer, DataQuestion, ModelInfo

log = logging.getLogger("assistant.data")

# Lý do trả cho người hỏi là chữ của dịch vụ, không phải `reason` của mô hình: chữ mô hình sinh không qua bước
# kiểm nào nên không hiện cho ai.
MODEL_DECLINED = (
    "Mô hình không viết câu truy vấn đọc dữ liệu cho câu hỏi này: câu hỏi nằm ngoài các bảng của mục, hỏi dữ "
    "liệu của đơn vị khác hay đòi sửa dữ liệu. Không câu nào được chạy."
)
GUARD_REFUSED = "Câu truy vấn mô hình viết không qua guard nên không được chạy: {reason}"
NO_TIME = (
    "Câu truy vấn mô hình viết không qua guard, và không còn thời gian để mô hình viết lại nên không câu nào "
    "được chạy: {reason}"
)

# Đồng hồ đặt tên riêng để kiểm thử hạn chung mà không phải chờ thật.
clock = time.monotonic


@dataclass
class Progress:
    """Câu và số lượt đã có tới lúc lỗi: lỗi sau khi mô hình viết câu vẫn ghi được câu đó vào nhật ký."""

    query: str | None = None
    attempts: int | None = None


@dataclass(frozen=True)
class _Written:
    """Kết thúc phần của mô hình: câu đã qua guard để chạy, hay lời từ chối trả ngay."""

    checked: guard.Checked | None
    answer: DataAnswer | None


@dataclass(frozen=True)
class _Rejected:
    """Câu bị guard từ chối ở một lượt, kèm lý do để gửi lại mô hình."""

    query: str
    reason: str


def ask(caller: Caller, request: DataQuestion, text: str, model: Model, progress: Progress) -> DataAnswer:
    data = data_run.data_config(caller, request.app, request.item)
    allow = data_run.allowlist_of(data, request.app, request.item)
    # Nhả lượt ngay sau mô hình: chờ Hasura không giữ chỗ của người hỏi văn bản.
    with one_turn():
        written = _write(model, data, allow, text, progress)
    if written.answer is not None:
        return written.answer
    checked = written.checked
    tables = data_run.run(caller, checked)
    if tables is None:
        return _refuse(data_run.HASURA_REFUSED, checked.query, "hasura", model.info, progress)
    return DataAnswer(
        outcome="data",
        reason=None,
        query=checked.query,
        tables=tables,
        model=model.info,
        attempts=progress.attempts,
    )


def _write(model: Model, data: dict, allow: guard.Allowlist, text: str, progress: Progress) -> _Written:
    deadline = clock() + settings.timeout_seconds
    messages = data_model.messages(data, allow.max_rows, text)
    content = model.chat(messages, data_model.QUERY_SCHEMA, "query", settings.timeout_seconds)
    first = _take(content, allow, model, progress, 1)
    if isinstance(first, _Written):
        return first
    remaining = deadline - clock()
    if remaining <= 0:
        return _refused(NO_TIME, first, model, progress)
    try:
        content = model.chat(
            data_model.repair(messages, content, first.reason), data_model.QUERY_SCHEMA, "query", remaining
        )
    except Denied as error:
        # Hết hạn chung trong lượt sửa: người hỏi nhận câu bị từ chối và lý do của guard thay vì 504, vì lượt
        # đầu đã có kết quả. Lỗi khác của mô hình (không chạy, quá tải) vẫn là lỗi.
        if error.status != 504:
            raise
        return _refused(NO_TIME, first, model, progress)
    second = _take(content, allow, model, progress, 2)
    if isinstance(second, _Written):
        return second
    return _refused(GUARD_REFUSED, second, model, progress)


def _take(
    content: str | None, allow: guard.Allowlist, model: Model, progress: Progress, attempt: int
) -> _Written | _Rejected:
    """Kết quả một lượt: câu qua guard, lời từ chối của mô hình, hay câu bị guard từ chối (để sửa)."""
    reply = data_model.parse(content, "Mô hình")
    progress.attempts = attempt
    if not reply["answerable"]:
        progress.query = None
        return _Written(None, _refuse(MODEL_DECLINED, "", "model", model.info, progress))
    query = reply["query"]
    progress.query = query or None
    try:
        return _Written(guard.check(query, allow), None)
    except guard.Refused as refused:
        # Lý do của guard có thể chép lại chuỗi trong câu (lấy từ câu hỏi), nên chỉ ở mức DEBUG như lý do của
        # mô hình; mức INFO chỉ ghi là có lượt bị từ chối.
        log.info("Guard từ chối câu mô hình viết ở lượt %s", attempt)
        log.debug("Lý do guard từ chối ở lượt %s: %s", attempt, refused.reason)
        return _Rejected(query, refused.reason)


def _refused(template: str, rejected: _Rejected, model: Model, progress: Progress) -> _Written:
    reason = template.format(reason=rejected.reason)
    return _Written(None, _refuse(reason, rejected.query, "guard", model.info, progress))


def _refuse(reason: str, query: str, by: str, info: ModelInfo | None, progress: Progress) -> DataAnswer:
    return DataAnswer(
        outcome="refused",
        reason=reason,
        query=query,
        tables=[],
        model=info,
        attempts=progress.attempts,
        refused_by=by,
    )
