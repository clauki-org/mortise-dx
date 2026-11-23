# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử lời gọi API tương thích OpenAI bằng máy chủ giả trong tiến trình (httpx.MockTransport), không cần
# mạng: yêu cầu tới {địa chỉ}/chat/completions, mang khóa ở header và JSON Schema ở `response_format`; khóa
# sai, không có mô hình, giới hạn tần suất, không kết nối được là 503 chỉ cách sửa; quá giờ là 504; nội dung
# sai dạng là 502 như Ollama; khóa không lọt vào log hay lý do trả cho người hỏi. Chọn nhà cung cấp: khai
# thiếu hay sai thì 503 chỉ biến cần sửa, không chuyển sang Ollama.

import json
import logging
from dataclasses import replace

import httpx
import pytest

from app import providers
from app.data_model import QUERY_SCHEMA
from app.errors import Denied
from app.model import ANSWER_SCHEMA, MALFORMED, TOO_SLOW, TRUNCATED, Ollama
from app.providers import OpenAICompatible, Unconfigured, configured
from tests.test_model import SENTENCES

KEY = "sk-test-key-never-logged"
REPLY = {"answerable": True, "answer": "Tối đa 14 ngày.", "sentences": ["p1.s2"]}


def completion(content: object) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": content}}]})


def api(handler, base: str = "https://llm.example.test/v1") -> OpenAICompatible:
    client = httpx.Client(base_url=base, transport=httpx.MockTransport(handler))
    return OpenAICompatible(base, "model-x", KEY, client)


def generate(handler) -> dict:
    return api(handler).generate("Đặt trước bao lâu?", SENTENCES)


@pytest.mark.parametrize(
    "base", ["https://llm.example.test/v1beta/openai", "https://llm.example.test/v1beta/openai/"]
)
def test_request_carries_schema_key_and_limits(base):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return completion(json.dumps(REPLY))

    model = api(handler, base)
    assert model.generate("Đặt trước bao lâu?", SENTENCES) == REPLY
    request = seen[0]
    assert str(request.url) == "https://llm.example.test/v1beta/openai/chat/completions"
    assert request.headers["authorization"] == f"Bearer {KEY}"
    body = json.loads(request.content)
    assert body["model"] == "model-x"
    assert body["response_format"] == {
        "type": "json_schema",
        "json_schema": {"name": "answer", "strict": True, "schema": ANSWER_SCHEMA},
    }
    assert (body["temperature"], body["max_tokens"]) == (0, 400)
    assert "[p1.s2]" in body["messages"][1]["content"]
    assert model.info.model_dump() == {
        "name": "model-x",
        "provider": "openai-compatible",
        "location": "api",
        "host": "llm.example.test",
    }


def status(code: int):
    return lambda request: httpx.Response(code, json={"error": {"message": f"lỗi, khóa {KEY[:6]}...{KEY}"}})


def timeout(request: httpx.Request) -> httpx.Response:
    raise httpx.ReadTimeout("chậm", request=request)


def unreachable(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("không phân giải được", request=request)


@pytest.mark.parametrize(
    ("handler", "code", "hint"),
    [
        (status(401), 503, "ASSISTANT_LLM_API_KEY"),
        (status(404), 503, "ASSISTANT_LLM_MODEL"),
        (status(429), 503, "thử lại sau"),
        (status(503), 503, "quá tải"),
        (unreachable, 503, "ASSISTANT_LLM_BASE_URL"),
        (status(500), 502, "log của assistant"),
        (timeout, 504, TOO_SLOW),
    ],
    ids=["bad-key", "no-model", "rate-limited", "overloaded", "unreachable", "server-error", "timeout"],
)
def test_failures_have_a_status_and_a_fix(handler, code, hint, caplog):
    with caplog.at_level(logging.DEBUG), pytest.raises(Denied) as raised:
        generate(handler)
    assert raised.value.status == code
    assert hint in raised.value.reason
    assert KEY not in raised.value.reason
    assert KEY not in caplog.text


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, text="<html>không phải JSON</html>"),
        httpx.Response(200, json={"choices": []}),
        completion(None),
        completion("không phải JSON"),
        completion(json.dumps({"answer": "14"})),
        completion(json.dumps(REPLY | {"sentences": "p1.s2"})),
    ],
    ids=["not-json", "no-choice", "null-content", "content-not-json", "missing-fields", "wrong-type"],
)
def test_malformed_reply_is_a_502_like_ollama(response):
    with pytest.raises(Denied) as raised:
        generate(lambda request: response)
    assert (raised.value.status, raised.value.reason) == (502, MALFORMED)


def with_settings(monkeypatch, **changes):
    monkeypatch.setattr(providers, "settings", replace(providers.settings, **changes))


def test_default_is_ollama():
    assert isinstance(configured(), Ollama)


API_SETTINGS = {
    "llm_provider": "openai-compatible",
    "llm_base_url": "https://llm.example.test/v1",
    "llm_host": "llm.example.test",
    "model": "model-x",
    "llm_api_key": KEY,
}


def test_api_is_chosen_when_fully_configured(monkeypatch):
    with_settings(monkeypatch, **API_SETTINGS)
    chosen = configured()
    assert isinstance(chosen, OpenAICompatible)
    assert chosen.info.host == "llm.example.test"


@pytest.mark.parametrize(
    ("changes", "hint"),
    [
        ({"llm_api_key": ""}, "thiếu ASSISTANT_LLM_API_KEY"),
        (
            {"llm_base_url": "", "llm_host": None, "model": ""},
            "thiếu ASSISTANT_LLM_BASE_URL, ASSISTANT_LLM_MODEL",
        ),
        ({"llm_base_url": "llm.example.test/v1", "llm_host": None}, "http:// hay https://"),
        ({"llm_base_url": "https://llm.example.test:abc/v1"}, "ASSISTANT_LLM_BASE_URL không hợp lệ"),
        ({"llm_provider": "openai"}, "chỉ nhận ollama hoặc openai-compatible"),
    ],
    ids=["no-key", "no-url-no-model", "no-scheme", "bad-port", "unknown-provider"],
)
def test_misconfiguration_is_a_503_never_a_fallback(monkeypatch, caplog, changes, hint):
    with_settings(monkeypatch, **(API_SETTINGS | changes))
    with caplog.at_level(logging.WARNING):
        chosen = configured()
    assert isinstance(chosen, Unconfigured)
    # Lỗi cấu hình hiện trong log lúc khởi động, không đợi câu hỏi đầu tiên.
    assert hint in caplog.text
    with pytest.raises(Denied) as raised:
        chosen.generate("Đặt trước bao lâu?", SENTENCES)
    assert raised.value.status == 503
    assert hint in raised.value.reason
    assert KEY not in caplog.text


def test_chat_carries_schema_name_and_timeout_and_logs_usage_without_content(caplog):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        body = {
            "choices": [{"message": {"content": '{"answerable": true}'}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 900, "completion_tokens": 41},
        }
        return httpx.Response(200, json=body)

    messages = [{"role": "user", "content": "Câu hỏi bí mật của người hỏi"}]
    with caplog.at_level(logging.INFO, logger="assistant"):
        assert api(handler).chat(messages, QUERY_SCHEMA, "query", 7.5) == '{"answerable": true}'
    body = json.loads(seen[0].content)
    assert body["response_format"] == {
        "type": "json_schema",
        "json_schema": {"name": "query", "strict": True, "schema": QUERY_SCHEMA},
    }
    assert (body["messages"], body["temperature"], body["max_tokens"]) == (messages, 0, 400)
    assert seen[0].extensions["timeout"]["read"] == 7.5
    (line,) = [r.getMessage() for r in caplog.records if r.name == "assistant.model"]
    assert "openai-compatible: 900 token vào, 41 token ra, dừng vì stop" in line
    assert "bí mật" not in caplog.text
    assert KEY not in caplog.text


def test_reply_cut_by_the_token_limit_is_a_502_naming_the_setting():
    reply = {"choices": [{"message": {"content": '{"ans'}, "finish_reason": "length"}]}
    with pytest.raises(Denied) as raised:
        api(lambda request: httpx.Response(200, json=reply)).chat([], QUERY_SCHEMA, "query", 5)
    assert (raised.value.status, raised.value.reason) == (502, TRUNCATED)


def test_unconfigured_chat_is_a_503_with_the_fix():
    with pytest.raises(Denied) as raised:
        Unconfigured("thiếu ASSISTANT_LLM_API_KEY").chat([], QUERY_SCHEMA, "query", 5)
    assert (raised.value.status, raised.value.reason) == (503, "thiếu ASSISTANT_LLM_API_KEY")


def test_startup_warning_says_table_descriptions_also_leave(monkeypatch, caplog):
    with_settings(monkeypatch, **API_SETTINGS)
    with caplog.at_level(logging.WARNING):
        configured()
    assert "mô tả bảng, cột" in caplog.text
    assert "Không gửi dòng dữ liệu" in caplog.text
