# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử lời gọi Ollama bằng máy chủ giả trong tiến trình: yêu cầu mang JSON Schema, nhiệt độ 0 và giới hạn
# số token; quá giờ là 504; Ollama chưa bật hay chưa tải mô hình là 503 chỉ cách bật; nội dung sai dạng là 502
# chứ không phải lỗi 500.

import json

import httpx
import pytest

from app.errors import Denied
from app.model import ANSWER_SCHEMA, NOT_RUNNING, Ollama
from app.retrieval import Sentence
from tests.passages import AMENDMENT

SENTENCES = [Sentence("p1.s2", AMENDMENT, "Phòng họp được đặt trước tối đa 14 ngày.")]


def ollama(handler) -> Ollama:
    return Ollama(httpx.Client(base_url="http://ollama", transport=httpx.MockTransport(handler)))


def test_request_is_constrained_and_deterministic():
    seen: list[dict] = []
    content = {"answerable": True, "answer": "Tối đa 14 ngày.", "sentences": ["p1.s2"]}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"message": {"content": json.dumps(content)}})

    assert ollama(handler).generate("Đặt trước bao lâu?", SENTENCES) == content
    body = seen[0]
    assert (body["model"], body["format"], body["stream"]) == ("qwen3.5:4b", ANSWER_SCHEMA, False)
    assert body["options"] == {"temperature": 0, "num_predict": 400}
    assert (
        "[p1.s2] (Quyết định mẫu sửa quy chế đặt phòng họp (hư cấu), Điều 1)"
        in body["messages"][1]["content"]
    )


def test_timeout_is_a_504():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("chậm", request=request)

    with pytest.raises(Denied) as raised:
        ollama(handler).generate("Đặt trước bao lâu?", SENTENCES)
    assert raised.value.status == 504


def test_malformed_reply_is_a_502():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"message": {"content": '{"answer": "14"}'}})

    with pytest.raises(Denied) as raised:
        ollama(handler).generate("Đặt trước bao lâu?", SENTENCES)
    assert raised.value.status == 502


def unreachable(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("không phân giải được ollama", request=request)


def not_pulled(request: httpx.Request) -> httpx.Response:
    return httpx.Response(404, json={"error": "model not found"})


@pytest.mark.parametrize("handler", [unreachable, not_pulled], ids=["profile-off", "model-not-pulled"])
def test_model_not_running_is_a_503_with_the_fix(handler):
    with pytest.raises(Denied) as raised:
        ollama(handler).generate("Đặt trước bao lâu?", SENTENCES)
    assert (raised.value.status, raised.value.reason) == (503, NOT_RUNNING)
