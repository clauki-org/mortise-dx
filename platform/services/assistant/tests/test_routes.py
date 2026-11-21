# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử cả đường ống qua route bằng mô hình giả (FakeModel) trả JSON soạn sẵn: trả lời có căn cứ, số bịa,
# mã câu lạ, mô hình từ chối, không có căn cứ (không gọi mô hình), câu hỏi quá dài, đang bận. Token và Hasura
# được thay bằng bản giả.

import pytest
from fastapi.testclient import TestClient

from app import pipeline, retrieval
from app.auth import caller_from_token
from app.errors import Denied
from app.main import app, model
from tests.passages import PASSAGES, USER_A

client = TestClient(app)
QUESTION = {"question": "Phòng họp được đặt trước tối đa bao nhiêu ngày?", "app": "core", "documents": ["x"]}


class FakeModel:
    def __init__(self, reply: dict | None = None, error: Denied | None = None):
        self.reply, self.error, self.calls = reply, error, 0

    def generate(self, question, sentences):
        self.calls += 1
        if self.error:
            raise self.error
        return self.reply


@pytest.fixture
def use(monkeypatch):
    monkeypatch.setattr(retrieval, "fetch", lambda caller, app_id, documents: PASSAGES)
    monkeypatch.setitem(app.dependency_overrides, caller_from_token, lambda: USER_A)

    def install(fake: FakeModel) -> FakeModel:
        monkeypatch.setitem(app.dependency_overrides, model, lambda: fake)
        return fake

    return install


def ask(body: dict = QUESTION) -> dict:
    response = client.post("/v1/assistant/questions", json=body)
    return {"status": response.status_code, **response.json()}


def test_grounded_answer_cites_the_stored_sentence(use):
    use(FakeModel({"answerable": True, "answer": "Tối đa 14 ngày.", "sentences": ["p1.s2"]}))
    result = ask()
    assert (result["status"], result["outcome"], result["answer"]) == (200, "answered", "Tối đa 14 ngày.")
    assert result["citations"] == [
        {
            "document_id": "example-rules-amendment",
            "title": "Quyết định mẫu sửa quy chế đặt phòng họp (hư cấu)",
            "passage_id": "art-1",
            "label": "Điều 1",
            "sentence": "Phòng họp được đặt trước tối đa 14 ngày.",
        }
    ]


@pytest.mark.parametrize(
    ("reply", "reason"),
    [
        ({"answerable": True, "answer": "Tối đa 15 ngày.", "sentences": ["p1.s2"]}, "15"),
        ({"answerable": True, "answer": "Tối đa 14 ngày.", "sentences": ["p7.s1"]}, "p7.s1"),
        ({"answerable": False, "answer": "", "sentences": []}, "không đủ"),
    ],
    ids=["invented-number", "unknown-sentence", "model-declines"],
)
def test_unverified_or_declined_answer_is_refused(use, reply, reason):
    use(FakeModel(reply))
    result = ask()
    assert (result["status"], result["outcome"], result["citations"]) == (200, "refused", [])
    assert reason in result["reason"]


def test_no_evidence_refuses_without_calling_the_model(use):
    fake = use(FakeModel())
    result = ask(QUESTION | {"question": "Lương cơ sở hiện nay là bao nhiêu?"})
    assert (result["outcome"], fake.calls) == ("refused", 0)


def test_question_too_long_is_rejected_before_retrieval(use, monkeypatch):
    fake = use(FakeModel())
    monkeypatch.setattr(retrieval, "fetch", lambda *args: pytest.fail("không được đọc văn bản"))
    result = ask(QUESTION | {"question": "x" * 301})
    assert (result["status"], fake.calls) == (400, 0)
    assert "300" in result["error"]


def test_model_timeout_is_a_504(use):
    use(FakeModel(error=Denied(504, "Mô hình trả lời quá thời gian cho phép; thử lại sau ít phút.")))
    assert ask()["status"] == 504


def test_second_question_while_generating_gets_503(use):
    fake = use(FakeModel())
    assert pipeline._generating.acquire(blocking=False)
    try:
        result = ask()
    finally:
        pipeline._generating.release()
    assert (result["status"], fake.calls) == (503, 0)


def test_unknown_field_is_a_400(use):
    use(FakeModel())
    assert ask(QUESTION | {"tenant": "xa-b"})["status"] == 400
