# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử bước kiểm câu trả lời (ADR 0021): số bịa, mã câu lạ, câu dẫn không nguyên văn đều bị chặn; số trong
# nhãn vị trí của đoạn được tính là có căn cứ.

from dataclasses import replace
from decimal import Decimal

import pytest

from app.retrieval import Sentence
from app.verify import Unverified, check, numbers
from tests.passages import AMENDMENT, BOOKING

SENTENCES = [
    Sentence("p1.s1", BOOKING, "Mỗi lần đặt không quá 4 giờ."),
    Sentence("p1.s2", BOOKING, "Người đặt hủy trước giờ họp ít nhất 1 giờ nếu không dùng."),
    Sentence("p2.s2", AMENDMENT, "Phòng họp được đặt trước tối đa 14 ngày."),
]


def reply(answer: str, *ids: str) -> dict:
    return {"answerable": True, "answer": answer, "sentences": list(ids)}


def test_numbers_are_read_the_vietnamese_way():
    assert numbers("1.000 m², 1,5 lần, 100%, 1.5") == {Decimal(1000), Decimal("1.5"), Decimal(100)}


def test_grounded_answer_returns_cited_sentences_in_order():
    cited = check(reply("Mỗi lần đặt tối đa 4 giờ.", "p1.s1", "p1.s1"), SENTENCES)
    assert [sentence.id for sentence in cited] == ["p1.s1"]


def test_invented_number_is_rejected():
    with pytest.raises(Unverified, match="15"):
        check(reply("Phòng họp được đặt trước tối đa 15 ngày.", "p2.s2"), SENTENCES)


def test_number_from_an_uncited_sentence_is_rejected():
    with pytest.raises(Unverified, match="14"):
        check(reply("Đặt trước tối đa 14 ngày.", "p1.s1"), SENTENCES)


def test_number_in_the_passage_label_counts_as_grounded():
    assert check(reply("Theo Điều 1, đặt trước tối đa 14 ngày.", "p2.s2"), SENTENCES)


def test_unknown_sentence_id_is_rejected():
    with pytest.raises(Unverified, match="p9.s1"):
        check(reply("Mỗi lần đặt tối đa 4 giờ.", "p1.s1", "p9.s1"), SENTENCES)


def test_answer_without_citation_is_rejected():
    with pytest.raises(Unverified):
        check(reply("Mỗi lần đặt tối đa 4 giờ."), SENTENCES)


def test_quote_must_be_verbatim():
    with pytest.raises(Unverified, match="nguyên văn"):
        check(reply("Quy chế ghi “mỗi lần đặt không quá bốn giờ”.", "p1.s1"), SENTENCES)
    assert check(reply("Quy chế ghi “Mỗi lần đặt không quá 4 giờ.”", "p1.s1"), SENTENCES)


def test_number_only_in_the_document_title_is_not_grounded():
    # ADR 0021 chỉ tính câu được trích và nhãn vị trí; tên văn bản hiện ở trích dẫn, không cần nhắc lại trong
    # câu trả lời.
    titled = Sentence("p1.s1", replace(BOOKING, title="Quy chế mẫu số 12"), "Mỗi lần đặt không quá 4 giờ.")
    with pytest.raises(Unverified, match="12"):
        check(reply("Theo Quy chế mẫu số 12, mỗi lần đặt tối đa 4 giờ.", "p1.s1"), [titled])
