# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Tìm đoạn làm căn cứ (ADR 0021, bước 2 và 3): đọc mọi đoạn được phép của các văn bản được hỏi qua GraphQL
# bằng token người hỏi, xếp hạng theo từ khóa trong tiến trình, rồi tách câu và đánh mã câu cho mô hình chọn.
# Không có đường nào khác tới dữ liệu: Hasura quyết định người hỏi thấy đoạn nào.

import logging
import math
import re
import unicodedata
from dataclasses import dataclass

import httpx

from .config import settings
from .errors import Denied

log = logging.getLogger("assistant.retrieval")
_client = httpx.Client(timeout=10)

# Đoạn đã bị thay (superseded_by) bị loại ngay trong câu truy vấn: trợ lý không trả lời theo nội dung hết hiệu
# lực.
QUERY = """
query Passages($app: String!, $documents: [String!]!) {
  platform_knowledge_passages(
    where: {app: {_eq: $app}, document_id: {_in: $documents}, superseded_by_passage: {_is_null: true}}
    order_by: [{document_id: asc}, {position: asc}]
  ) { tenant_id document_id passage_id label text document { title } }
}
"""
# Ranh câu: sau dấu kết câu có khoảng trắng, hay xuống dòng. Câu là đơn vị mô hình chọn và hệ thống trích.
_SENTENCE_END = re.compile(r"(?<=[.;:!?])\s+|\n+")
_WORD = re.compile(r"\w+")


@dataclass(frozen=True)
class Caller:
    sub: str
    tenant: str
    token: str
    # Vai trò realm trong token (realm_access.roles); trợ lý dữ liệu so với `roles` của mục menu.
    roles: tuple[str, ...] = ()


@dataclass(frozen=True)
class Passage:
    document_id: str
    title: str
    passage_id: str
    label: str
    text: str


@dataclass(frozen=True)
class Sentence:
    id: str
    passage: Passage
    text: str


def fetch(caller: Caller, app: str, documents: list[str]) -> list[Passage]:
    body = {"query": QUERY, "variables": {"app": app, "documents": documents}}
    try:
        response = _client.post(
            settings.graphql_url, json=body, headers={"Authorization": f"Bearer {caller.token}"}
        )
        payload = response.json()
    except (httpx.HTTPError, ValueError) as error:
        log.error("Không đọc được văn bản qua GraphQL: %s", error)
        raise Denied(503, "Không đọc được văn bản; báo người vận hành kiểm tra `make ps`.") from error
    if not response.is_success or payload.get("errors") or not isinstance(payload.get("data"), dict):
        log.error("GraphQL trả %s: %s", response.status_code, str(payload)[:2000])
        raise Denied(
            502, "API dữ liệu từ chối câu truy vấn văn bản; báo người vận hành xem log của assistant."
        )
    rows = payload["data"].get("platform_knowledge_passages") or []
    # Hasura đã lọc theo tenant của token; bỏ thêm ở đây để một quyền khai sai không đưa đoạn của tenant khác
    # vào câu trả lời.
    return [
        Passage(row["document_id"], row["document"]["title"], row["passage_id"], row["label"], row["text"])
        for row in rows
        if row["tenant_id"] == caller.tenant
    ]


def words(text: str) -> list[str]:
    """Từ đã chuẩn hóa: chữ thường, bỏ dấu, đ thành d, để câu hỏi gõ không dấu vẫn khớp."""
    plain = unicodedata.normalize("NFD", text.lower().replace("đ", "d"))
    return _WORD.findall("".join(char for char in plain if not unicodedata.combining(char)))


def _terms(text: str) -> set[str]:
    # Tiếng Việt viết mỗi âm tiết một chữ, nên cặp âm tiết liền nhau gần với "từ" hơn một âm tiết đơn lẻ.
    tokens = words(text)
    return set(tokens) | {f"{left} {right}" for left, right in zip(tokens, tokens[1:], strict=False)}


def rank(question: str, passages: list[Passage]) -> list[tuple[float, Passage]]:
    """Điểm mỗi đoạn là phần trọng số của câu hỏi mà đoạn có, trong khoảng 0 tới 1, cao trước.

    Trọng số theo độ hiếm của từ trong các đoạn được phép (IDF): từ có ở mọi đoạn gần như không tính, từ
    không có ở đoạn nào nặng nhất. Câu hỏi về điều văn bản không nói vì vậy có điểm thấp và bị từ chối trước
    khi gọi mô hình.
    """
    asked = _terms(question)
    if not asked or not passages:
        return []
    texts = [_terms(f"{passage.label} {passage.text}") for passage in passages]
    weight = {
        term: math.log((len(texts) + 1) / (sum(term in text for text in texts) + 0.5)) for term in asked
    }
    total = sum(weight.values())
    scored = [
        (sum(weight[term] for term in asked & text) / total, p)
        for text, p in zip(texts, passages, strict=True)
    ]
    return sorted(scored, key=lambda item: item[0], reverse=True)


def evidence(question: str, passages: list[Passage]) -> list[Sentence]:
    """Câu của tối đa `top_passages` đoạn đạt ngưỡng, mã p<đoạn>.s<câu>; rỗng là không có căn cứ."""
    passing = [passage for score, passage in rank(question, passages) if score >= settings.min_score]
    chosen = passing[: settings.top_passages]
    sentences = []
    for number, passage in enumerate(chosen, start=1):
        parts = [part.strip() for part in _SENTENCE_END.split(passage.text) if part.strip()]
        sentences += [
            Sentence(f"p{number}.s{index}", passage, part) for index, part in enumerate(parts, start=1)
        ]
    return sentences
