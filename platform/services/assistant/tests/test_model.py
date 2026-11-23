# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử lời gọi Ollama bằng máy chủ giả trong tiến trình: yêu cầu mang JSON Schema, nhiệt độ 0 và giới hạn
# số token; quá giờ là 504; Ollama chưa bật hay chưa tải mô hình là 503 chỉ cách bật; nội dung sai dạng là 502
# chứ không phải lỗi 500; `chat` mang schema và thời gian chờ của người gọi, ghi một dòng log không kèm nội
# dung, và câu bị cắt vì hết token là 502 chỉ biến cần tăng.

import json
import logging

import httpx
import pytest

from app.data_model import QUERY_SCHEMA
from app.errors import Denied
from app.model import ANSWER_SCHEMA, NOT_RUNNING, TRUNCATED, Ollama
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


def test_chat_carries_schema_and_timeout_and_logs_counts_without_content(caplog):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        reply = {"message": {"content": '{"answerable": false, "query": "", "reason": "r"}'}}
        return httpx.Response(
            200, json=reply | {"done_reason": "stop", "prompt_eval_count": 812, "eval_count": 37}
        )

    messages = [{"role": "user", "content": "Câu hỏi bí mật của người hỏi"}]
    with caplog.at_level(logging.INFO, logger="assistant"):
        content = ollama(handler).chat(messages, QUERY_SCHEMA, "query", 12.5)
    assert content == '{"answerable": false, "query": "", "reason": "r"}'
    body = json.loads(seen[0].content)
    assert (body["format"], body["messages"], body["think"]) == (QUERY_SCHEMA, messages, False)
    assert body["options"] == {"temperature": 0, "num_predict": 400}
    assert seen[0].extensions["timeout"]["read"] == 12.5
    (line,) = [r.getMessage() for r in caplog.records if r.name == "assistant.model"]
    assert "ollama: 812 token vào, 37 token ra, dừng vì stop" in line
    assert "bí mật" not in caplog.text


def test_reply_cut_by_the_token_limit_is_a_502_naming_the_setting():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"message": {"content": '{"answerable": tr'}, "done_reason": "length"}
        )

    with pytest.raises(Denied) as raised:
        ollama(handler).chat([], QUERY_SCHEMA, "query", 5)
    assert (raised.value.status, raised.value.reason) == (502, TRUNCATED)
    assert "ASSISTANT_NUM_PREDICT" in TRUNCATED
