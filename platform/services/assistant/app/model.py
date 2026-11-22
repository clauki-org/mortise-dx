# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Gọi mô hình (ADR 0021, bước 4): phần chung cho mọi nhà cung cấp (prompt, JSON Schema, kiểm dạng câu trả
# lời) và lời gọi Ollama tại chỗ. Lời gọi qua API tương thích OpenAI và việc chọn nhà cung cấp theo cấu hình ở
# providers.py. Prompt chung, không có từ nghiệp vụ: mọi điều về lĩnh vực nằm trong các câu được đánh mã. JSON
# Schema buộc mô hình trả đúng ba trường; mô hình chỉ chọn mã câu, câu trích do pipeline.py chép từ dữ liệu.

import json
import logging
from typing import Protocol

import httpx

from .config import settings
from .errors import Denied
from .retrieval import Sentence
from .schemas import ModelInfo

log = logging.getLogger("assistant.model")

ANSWER_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["answerable", "answer", "sentences"],
    "properties": {
        "answerable": {"type": "boolean"},
        "answer": {"type": "string"},
        "sentences": {"type": "array", "items": {"type": "string"}},
    },
}

SYSTEM = (
    "Trả lời câu hỏi chỉ bằng các câu có mã trong ngoặc vuông được đưa kèm, bằng tiếng Việt, ngắn gọn. "
    "Ghi mã của mọi câu dùng làm căn cứ vào `sentences`, chép đúng mã. "
    "Không dùng con số nào không có trong các câu đó. "
    "Không nhắc lại tên văn bản: trích dẫn được hiện riêng. "
    "Các câu không đủ để trả lời thì đặt `answerable` là false và để `answer` rỗng."
)


NOT_RUNNING = "Mô hình chưa chạy; người vận hành bật bằng make ai-up."
TOO_SLOW = "Mô hình trả lời quá thời gian cho phép; thử lại sau ít phút."
MALFORMED = "Mô hình trả nội dung không đúng dạng; báo người vận hành xem log."


class Model(Protocol):
    # Ghi vào câu trả lời để người hỏi biết mô hình nào trả lời và chạy ở đâu; None khi không gọi được mô hình
    # nào (providers.Unconfigured).
    info: ModelInfo | None

    def generate(self, question: str, sentences: list[Sentence]) -> dict: ...


def prompt(question: str, sentences: list[Sentence]) -> str:
    lines = [f"[{s.id}] ({s.passage.title}, {s.passage.label}) {s.text}" for s in sentences]
    return f"Câu hỏi: {question}\n\nCác câu:\n" + "\n".join(lines)


class Ollama:
    def __init__(self, client: httpx.Client | None = None):
        self._client = client or httpx.Client(base_url=settings.ollama_url)
        self.info = ModelInfo(name=settings.model, provider="ollama", location="local", host=None)

    def generate(self, question: str, sentences: list[Sentence]) -> dict:
        body = {
            "model": settings.model,
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": prompt(question, sentences)},
            ],
            "format": ANSWER_SCHEMA,
            "stream": False,
            # Không cho mô hình viết phần suy nghĩ trước câu trả lời: tốn thời gian sinh mà không được dùng.
            "think": False,
            "options": {"temperature": 0, "num_predict": settings.num_predict},
        }
        try:
            response = self._client.post("/api/chat", json=body, timeout=settings.timeout_seconds)
        # Profile `ai` tắt thì tên ollama không phân giải được hay không kết nối được: đó là "chưa bật", không
        # phải "chậm", nên kiểm trước TimeoutException (ConnectTimeout là con của nó).
        except (httpx.ConnectError, httpx.ConnectTimeout) as error:
            log.warning("Không kết nối được Ollama: %s", error)
            raise Denied(503, NOT_RUNNING) from error
        except httpx.TimeoutException as error:
            raise Denied(504, TOO_SLOW) from error
        except httpx.HTTPError as error:
            log.error("Không gọi được Ollama: %s", error)
            raise Denied(503, NOT_RUNNING) from error
        if response.status_code == 404:
            # Ollama trả 404 khi mô hình chưa được tải.
            raise Denied(503, NOT_RUNNING)
        if not response.is_success:
            log.error("Ollama trả %s: %s", response.status_code, response.text[:2000])
            raise Denied(502, "Mô hình trả lỗi; báo người vận hành xem log của assistant.")
        try:
            content = response.json()["message"]["content"]
        except (ValueError, KeyError, TypeError):
            content = None
        # `format` buộc đúng dạng ở phía Ollama; kiểm lại để một bản Ollama bỏ qua `format` không làm dịch vụ
        # lỗi 500.
        return parse_reply(content, "Ollama", response.text)


def parse_reply(content: object, source: str, raw: str) -> dict:
    """Câu trả lời từ chuỗi JSON mô hình sinh; sai dạng là 502, cùng cách với mọi nhà cung cấp."""
    try:
        reply = json.loads(content) if isinstance(content, str) else None
    except ValueError:
        reply = None
    if not _well_formed(reply):
        # `raw` là phản hồi của mô hình, không chứa prompt; ghi ở mức ERROR để người vận hành thấy vì sao.
        log.error("%s trả nội dung không đúng dạng: %s", source, raw[:2000])
        raise Denied(502, MALFORMED)
    return reply


def _well_formed(reply: object) -> bool:
    return (
        isinstance(reply, dict)
        and isinstance(reply.get("answerable"), bool)
        and isinstance(reply.get("answer"), str)
        and isinstance(reply.get("sentences"), list)
        and all(isinstance(item, str) for item in reply["sentences"])
    )
