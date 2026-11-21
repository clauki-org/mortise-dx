# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm câu trả lời của mô hình trước khi đưa cho người hỏi (ADR 0021, bước 5). Lượt đo #114 cho thấy mô hình
# bịa số và kèm một câu trích có thật nhưng không liên quan, nên câu trích có thật thôi chưa đủ: mọi con số
# trong câu trả lời cũng phải có trong câu được trích. Hàm thuần, không gọi mạng.

import re
from decimal import Decimal, InvalidOperation

from .retrieval import Sentence

_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")
_QUOTED = re.compile(r"[\"“]([^\"”]+)[\"”]")


class Unverified(Exception):
    """Câu trả lời không qua bước kiểm; lý do hiện cho người hỏi."""


def _value(raw: str) -> Decimal | None:
    # Cách viết số tiếng Việt: chấm ngăn hàng nghìn, phẩy thập phân. Dấu chấm không theo nhóm ba chữ số thì là
    # cách viết thập phân của mô hình, đọc như vậy để "1.5" không thành 15.
    if "," in raw:
        raw = raw.replace(".", "").replace(",", ".")
    elif "." in raw and all(len(group) == 3 for group in raw.split(".")[1:]):
        raw = raw.replace(".", "")
    try:
        return Decimal(raw)
    except InvalidOperation:
        return None


def numbers(text: str) -> set[Decimal]:
    return {value for raw in _NUMBER.findall(text) if (value := _value(raw)) is not None}


def _squash(text: str) -> str:
    return " ".join(text.split())


def check(reply: dict, sentences: list[Sentence]) -> list[Sentence]:
    """Câu được trích, theo thứ tự mô hình ghi; Unverified nếu một điều kiện của ADR 0021 không đạt."""
    known = {sentence.id: sentence for sentence in sentences}
    ids = list(dict.fromkeys(reply["sentences"]))
    if not ids or not reply["answer"].strip():
        raise Unverified("Mô hình trả lời mà không chỉ ra câu căn cứ nào.")
    unknown = [sentence_id for sentence_id in ids if sentence_id not in known]
    if unknown:
        raise Unverified(f"Mô hình trích câu không có trong các đoạn đã tìm ({', '.join(unknown)}).")
    cited = [known[sentence_id] for sentence_id in ids]
    quoted = _squash(" ".join(sentence.text for sentence in cited))
    for span in _QUOTED.findall(reply["answer"]):
        if _squash(span) not in quoted:
            raise Unverified("Câu trả lời dẫn một đoạn không có nguyên văn trong câu được trích.")
    grounded = numbers(" ".join(f"{sentence.passage.label} {sentence.text}" for sentence in cited))
    invented = numbers(reply["answer"]) - grounded
    if invented:
        shown = ", ".join(sorted(format(value, "f") for value in invented))
        raise Unverified(f"Câu trả lời có số không có trong câu được trích ({shown}).")
    return cited
