# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử bước tìm: đọc qua GraphQL bằng đúng token người hỏi, không bao giờ đưa đoạn của tenant khác vào căn
# cứ, câu hỏi không liên quan không đạt ngưỡng. Hasura được thay bằng máy chủ giả trong tiến trình
# (httpx.MockTransport).

import json

import httpx
import pytest

from app import retrieval
from app.errors import Denied
from tests.passages import AMENDMENT, BOOKING, PASSAGES, USER_A


def row(tenant: str, passage) -> dict:
    return {
        "tenant_id": tenant,
        "document_id": passage.document_id,
        "passage_id": passage.passage_id,
        "label": passage.label,
        "text": passage.text,
        "document": {"title": passage.title},
    }


def hasura(monkeypatch, status: int, body: dict) -> list[httpx.Request]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(status, json=body)

    monkeypatch.setattr(retrieval, "_client", httpx.Client(transport=httpx.MockTransport(handler)))
    return seen


def test_reads_with_the_askers_token_and_skips_superseded(monkeypatch):
    seen = hasura(monkeypatch, 200, {"data": {"platform_knowledge_passages": [row("xa-a", BOOKING)]}})
    assert retrieval.fetch(USER_A, "core", ["example-rules"]) == [BOOKING]
    request = seen[0]
    assert request.headers["Authorization"] == "Bearer token-of-user-a"
    assert "x-hasura-admin-secret" not in request.headers
    sent = json.loads(request.content)
    assert sent["variables"] == {"app": "core", "documents": ["example-rules"]}
    assert "superseded_by_passage: {_is_null: true}" in sent["query"]


def test_passage_of_another_tenant_is_never_retrievable(monkeypatch):
    rows = [row("xa-b", AMENDMENT), row("xa-a", BOOKING)]
    hasura(monkeypatch, 200, {"data": {"platform_knowledge_passages": rows}})
    assert retrieval.fetch(USER_A, "core", ["example-rules", "example-rules-amendment"]) == [BOOKING]


def test_graphql_error_is_reported_without_details(monkeypatch):
    hasura(monkeypatch, 200, {"errors": [{"message": "field not found in type: 'query_root'"}]})
    with pytest.raises(Denied) as raised:
        retrieval.fetch(USER_A, "core", ["example-rules"])
    assert raised.value.status == 502
    assert "query_root" not in raised.value.reason


def test_question_without_accents_still_matches():
    best_score, best = retrieval.rank("dat truoc toi da bao nhieu ngay", PASSAGES)[0]
    assert best == AMENDMENT
    assert best_score >= 0.3


def test_unrelated_question_has_no_evidence():
    assert retrieval.evidence("Lương cơ sở hiện nay là bao nhiêu?", PASSAGES) == []


def test_evidence_numbers_sentences_per_passage():
    sentences = retrieval.evidence("Phòng họp được đặt trước tối đa bao nhiêu ngày?", PASSAGES)
    assert sentences[0].id == "p1.s1"
    assert [s.text for s in sentences if s.passage == AMENDMENT] == [
        "Sửa khoản 1 Điều 1 của Quy chế mẫu như sau.",
        "Phòng họp được đặt trước tối đa 14 ngày.",
    ]
