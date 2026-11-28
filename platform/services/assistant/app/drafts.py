# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Bản nháp cấu hình gói (ADR 0071): quản trị đơn vị gõ nhu cầu; mô hình soạn app.yaml và cấu hình của từng mục
# menu, khối từ tài liệu nền tảng, bản mô tả và ví dụ trong contracts/ (draft_prompt.py); bản nháp được kiểm
# theo luật của bộ kiểm gói (draft_check.py); có lỗi thì mô hình được sửa một lần theo đúng lỗi đó. Dịch vụ
# chỉ trả bản nháp, không ghi vào apps/: cấu hình hệ thống do quản trị viên tự xem rồi tự cài (`make
# app-install`). main.py ghi nhật ký mỗi lần soạn (journal.py). Hai lời gọi mô hình chung một hạn
# (ASSISTANT_TIMEOUT_SECONDS) và giữ lượt sinh dùng chung với các đường khác của trợ lý.

import logging
import time
import unicodedata
from dataclasses import dataclass

from . import draft_check, draft_contracts, draft_prompt
from .config import settings
from .errors import Denied
from .model import TRUNCATED, Model, one_turn
from .retrieval import Caller
from .schemas import DraftArgument, DraftChoice, DraftFile, DraftProblem, DraftRequest, PackageDraft

log = logging.getLogger("assistant.draft")

ADMIN_ROLE = "tenant_admin"
NOT_ADMIN = (
    "Chỉ quản trị đơn vị (vai trò tenant_admin) được soạn bản nháp cấu hình gói: cấu hình hệ thống cần quản "
    "trị viên chấp nhận."
)
# Lý do trả cho người gọi là chữ của dịch vụ, không phải `reason` của mô hình: chữ mô hình sinh không qua bước
# kiểm nào nên không hiện cho ai.
MODEL_DECLINED = (
    "Mô hình không soạn được bản nháp cho nhu cầu này bằng các thành phần hiện có; mô tả cụ thể hơn các màn "
    "hình cần có."
)
STILL_INVALID = "Bản nháp còn lỗi sau một lượt sửa; xem `problems` và sửa tay trước khi đặt vào apps/."
NO_TIME = "Bản nháp có lỗi và không còn thời gian để mô hình sửa; xem `problems` và sửa tay."
# Bản nháp có trần token sinh riêng: lời báo chung của model.py chỉ tới ASSISTANT_NUM_PREDICT, sửa số đó không
# giúp gì.
DRAFT_TRUNCATED = (
    "Mô hình dừng giữa chừng vì hết số token được sinh cho bản nháp; người vận hành tăng "
    "ASSISTANT_DRAFT_NUM_PREDICT (và ASSISTANT_DRAFT_NUM_CTX với Ollama) trong compose.yaml rồi chạy make up."
)
# Lập luận đọc được trong một lần xem; mô hình trả nhiều hơn thì giữ các lập luận đầu.
MAX_ARGUMENTS = 3

# Đồng hồ đặt tên riêng để kiểm thử hạn chung mà không phải chờ thật.
clock = time.monotonic


@dataclass
class Progress:
    """Phần đã có trước khi một lỗi chặn trả lời: dòng nhật ký của lần lỗi vẫn ghi số lượt mô hình đã trả."""

    attempts: int | None = None


@dataclass(frozen=True)
class _Turn:
    """Một lượt mô hình viết: câu trả lời đã kiểm dạng và kết quả kiểm theo hợp đồng."""

    reply: dict
    checked: draft_check.Checked

    @property
    def declined(self) -> bool:
        return not self.reply["answerable"]


def draft(caller: Caller, request: DraftRequest, model: Model, progress: Progress) -> PackageDraft:
    if ADMIN_ROLE not in caller.roles:
        raise Denied(403, NOT_ADMIN)
    need = need_text(request.need)
    contracts = draft_contracts.load()
    with one_turn():
        return _write(model, contracts, need, progress)


def need_text(need: str) -> str:
    text = need.strip()
    if not text:
        raise Denied(400, "Mô tả nhu cầu trống.")
    if len(text) > settings.max_question_chars:
        raise Denied(400, f"Mô tả nhu cầu dài quá {settings.max_question_chars} ký tự; viết ngắn hơn.")
    return text


def _write(model: Model, contracts: draft_contracts.Contracts, need: str, progress: Progress) -> PackageDraft:
    deadline = clock() + settings.timeout_seconds
    messages = draft_prompt.messages(contracts, need)
    content = _chat(model, messages, settings.timeout_seconds)
    first = _take(content, contracts, progress)
    if first.declined or not first.checked.problems:
        return _answer(first, contracts, model, need, 1)
    remaining = deadline - clock()
    if remaining <= 0:
        return _answer(first, contracts, model, need, 1, NO_TIME)
    problems = [f"{p.path}: {p.message}" for p in first.checked.problems]
    try:
        content = _chat(model, draft_prompt.repair(messages, content, problems), remaining)
    except Denied as error:
        # Hết hạn chung trong lượt sửa: người gọi nhận bản nháp lượt đầu kèm lỗi thay vì 504, vì lượt đầu đã
        # có kết quả. Lỗi khác của mô hình (không chạy, quá tải) vẫn là lỗi.
        if error.status != 504:
            raise
        return _answer(first, contracts, model, need, 1, NO_TIME)
    second = _take(content, contracts, progress)
    # Lượt sửa nói không soạn được thì trả bản nháp lượt đầu: dù còn lỗi, nó vẫn có ích hơn lời từ chối.
    return _answer(first if second.declined else second, contracts, model, need, 2, STILL_INVALID)


def _chat(model: Model, messages: list[dict], timeout: float) -> str | None:
    try:
        return model.chat(
            messages,
            draft_prompt.DRAFT_SCHEMA,
            "package_draft",
            timeout,
            settings.draft_num_predict,
            settings.draft_num_ctx,
        )
    except Denied as error:
        if error.reason == TRUNCATED:
            raise Denied(502, DRAFT_TRUNCATED) from error
        raise


def _take(content: str | None, contracts: draft_contracts.Contracts, progress: Progress) -> _Turn:
    reply = draft_prompt.parse(content)
    progress.attempts = (progress.attempts or 0) + 1
    files = [(f["path"], f["content"]) for f in reply["files"]]
    checked = draft_check.check(files, contracts) if reply["answerable"] else draft_check.Checked()
    log.info("Bản nháp cấu hình gói: %s tệp, %s lỗi", len(files), len(checked.problems))
    return _Turn(reply, checked)


def _answer(
    turn: _Turn,
    contracts: draft_contracts.Contracts,
    model: Model,
    need: str,
    attempts: int,
    invalid_reason: str = "",
) -> PackageDraft:
    if turn.declined:
        return PackageDraft(
            outcome="refused",
            reason=MODEL_DECLINED,
            files=[],
            problems=[],
            to_write=[],
            choices=[],
            model=model.info,
            attempts=attempts,
        )
    checked = turn.checked
    return PackageDraft(
        outcome="invalid" if checked.problems else "drafted",
        reason=invalid_reason if checked.problems else None,
        files=[
            DraftFile(path=f["path"], component=checked.components.get(f["path"]), content=f["content"])
            for f in turn.reply["files"]
        ],
        problems=[DraftProblem(path=p.path, message=p.message) for p in checked.problems],
        to_write=[DraftProblem(path=p.path, message=p.message) for p in checked.to_write],
        choices=_choices(turn.reply["choices"], checked.items, contracts, need),
        model=model.info,
        attempts=attempts,
    )


def _choices(
    chosen: list[dict], items: dict[str, str], contracts: draft_contracts.Contracts, need: str
) -> list[DraftChoice]:
    """Lập luận chọn thành phần của từng mục: đoạn nhu cầu phải có trong nhu cầu, công dụng là câu chép từ bản
    mô tả theo mã mô hình chỉ ra; lập luận trượt một trong hai thì bị bỏ, vì phần đó là chữ mô hình bịa."""
    said = _comparable(need)
    by_item: dict[str, DraftChoice] = {}
    for choice in chosen:
        item = choice["item"]
        component = items.get(item)
        if component is None or item in by_item:
            continue
        arguments = _arguments(choice["arguments"], contracts.components[component].lines, said)
        by_item[item] = DraftChoice(item=item, component=component, arguments=arguments)
    return list(by_item.values())


def _arguments(arguments: list[dict], lines: dict[str, str], said: str) -> list[DraftArgument]:
    kept: list[DraftArgument] = []
    for argument in arguments:
        if len(kept) == MAX_ARGUMENTS:
            break
        quote, code = argument["need"].strip(), argument["code"].strip().strip("[]")
        heard = _comparable(quote)
        if code in lines and heard and heard in said:
            kept.append(DraftArgument(need=quote, capability=lines[code], why=argument["why"].strip()))
    return kept


def _comparable(text: str) -> str:
    # Mô hình hiếm khi chép đúng từng byte: dạng Unicode khác (dấu tổ hợp hay dựng sẵn), hoa thường, khoảng
    # trắng, ngoặc kép và dấu câu ở hai đầu. So sau khi bỏ những khác biệt đó, không bỏ chữ nào ở giữa.
    folded = " ".join(unicodedata.normalize("NFC", text).casefold().split())
    return folded.strip(" \"'“”‘’.,;:!?")
