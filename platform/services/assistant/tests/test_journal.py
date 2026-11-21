# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử cách ghi một dòng nhật ký câu hỏi bằng kết nối giả: người làm đặt trong cùng giao dịch (nhật ký
# thay đổi đọc nó), câu trích ghi dạng JSON, lỗi ghi là 503 chứ không lặng lẽ bỏ qua.

import json

import pytest
from pg8000.exceptions import DatabaseError

from app import journal
from app.errors import Denied
from app.schemas import Answer, Citation, Question
from tests.passages import AMENDMENT, USER_A

QUESTION = Question(
    question=" Đặt trước bao lâu? ", app="core", documents=["example-rules", "example-rules-amendment"]
)
CITATION = Citation(
    document_id=AMENDMENT.document_id,
    title=AMENDMENT.title,
    passage_id=AMENDMENT.passage_id,
    label=AMENDMENT.label,
    sentence="Phòng họp được đặt trước tối đa 14 ngày.",
)


class FakeConnection:
    def __init__(self, fail_on: str = ""):
        self.runs: list[tuple[str, dict]] = []
        self.fail_on, self.closed = fail_on, False

    def run(self, sql: str, **params):
        self.runs.append((sql, params))
        if self.fail_on and self.fail_on in sql:
            raise DatabaseError({"C": "42501", "M": "permission denied"})

    def close(self):
        self.closed = True


def test_answer_is_written_in_one_transaction_with_the_actor(monkeypatch):
    connection = FakeConnection()
    monkeypatch.setattr(journal, "_connect", lambda: connection)
    answer = Answer(outcome="answered", answer="Tối đa 14 ngày.", reason=None, citations=[CITATION])
    journal.record(USER_A, QUESTION, 1234, answer)
    statements = [sql.split()[0] for sql, _ in connection.runs]
    assert statements == ["BEGIN", "SELECT", "INSERT", "COMMIT"]
    assert connection.runs[1][1] == {"actor": "u-a"}
    params = connection.runs[2][1]
    assert (params["tenant"], params["outcome"], params["question"]) == (
        "xa-a",
        "answered",
        "Đặt trước bao lâu?",
    )
    assert params["documents"] == "{example-rules,example-rules-amendment}"
    assert json.loads(params["citations"])[0]["sentence"] == "Phòng họp được đặt trước tối đa 14 ngày."
    assert connection.closed


def test_failure_is_written_with_its_reason(monkeypatch):
    connection = FakeConnection()
    monkeypatch.setattr(journal, "_connect", lambda: connection)
    journal.record(USER_A, QUESTION, 10, None, "Mô hình chưa chạy; người vận hành bật bằng make ai-up.")
    params = connection.runs[2][1]
    assert (params["outcome"], params["answer"], params["citations"]) == ("failed", None, "[]")


def test_refused_write_is_a_503(monkeypatch):
    connection = FakeConnection(fail_on="INSERT")
    monkeypatch.setattr(journal, "_connect", lambda: connection)
    with pytest.raises(Denied) as raised:
        journal.record(USER_A, QUESTION, 10, None, "lỗi")
    assert raised.value.status == 503
    assert connection.closed
