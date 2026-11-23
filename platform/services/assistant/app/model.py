# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Gọi mô hình (ADR 0021, bước 4; ADR 0034): phần chung cho mọi nhà cung cấp (prompt hỏi văn bản, JSON Schema,
# kiểm dạng câu trả lời, lượt sinh dùng chung, dòng log mỗi lời gọi) và lời gọi Ollama tại chỗ. Lời gọi qua
# API tương thích OpenAI và việc chọn nhà cung cấp theo cấu hình ở providers.py. Mỗi nhà cung cấp có `chat`
# (gửi các tin nhắn, nhận chữ JSON theo một schema) mà cả hỏi văn bản (`generate`, bọc mỏng quanh `chat`) và
# hỏi dữ liệu (data_model.py) dùng. Prompt hỏi văn bản chung, không có từ nghiệp vụ: mọi điều về lĩnh vực nằm
# trong các câu được đánh mã; mô hình chỉ chọn mã câu, câu trích do pipeline.py chép từ dữ liệu.

import json
import logging
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
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
BUSY = "Trợ lý đang trả lời một câu hỏi khác; thử lại sau ít phút."
TRUNCATED = (
    "Mô hình dừng giữa chừng vì hết số token được sinh; người vận hành tăng ASSISTANT_NUM_PREDICT trong "
    "compose.yaml rồi chạy make up."
)

# Một lượt sinh mỗi lúc, chung cho hỏi văn bản và hỏi dữ liệu: mô hình chạy trên CPU, lượt thứ hai chạy song
# song chỉ làm cả hai chậm hơn (ADR 0021); qua API cũng vậy (bổ sung 2026-11-22 của ADR 0021). Câu hỏi dữ liệu
# giữ lượt qua cả lời gọi đầu và lượt sửa, để lượt sửa không phải chờ sau câu hỏi của người khác.
_generating = threading.Lock()


class Model(Protocol):
    # Ghi vào câu trả lời để người hỏi biết mô hình nào trả lời và chạy ở đâu; None khi không gọi được mô hình
    # nào (providers.Unconfigured).
    info: ModelInfo | None

    def generate(self, question: str, sentences: list[Sentence]) -> dict: ...

    def chat(self, messages: list[dict], schema: dict, name: str, timeout: float) -> str | None: ...


def prompt(question: str, sentences: list[Sentence]) -> str:
    lines = [f"[{s.id}] ({s.passage.title}, {s.passage.label}) {s.text}" for s in sentences]
    return f"Câu hỏi: {question}\n\nCác câu:\n" + "\n".join(lines)


def answer_messages(question: str, sentences: list[Sentence]) -> list[dict]:
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt(question, sentences)}]


@contextmanager
def one_turn() -> Iterator[None]:
    """Giữ lượt sinh cho mọi lời gọi mô hình trong khối; đang có lượt khác thì 503 ngay, không xếp hàng."""
    if not _generating.acquire(blocking=False):
        raise Denied(503, BUSY)
    try:
        yield
    finally:
        _generating.release()


def log_call(provider: str, tokens_in: object, tokens_out: object, stop: object, started: float) -> None:
    # Không ghi nội dung prompt hay câu trả lời: câu hỏi có thể chứa dữ liệu cá nhân, mà log không có quyền
    # theo tenant như nhật ký câu hỏi. Số token và lý do dừng đủ để người vận hành chỉnh
    # ASSISTANT_NUM_PREDICT.
    log.info(
        "Gọi mô hình %s: %s token vào, %s token ra, dừng vì %s, %.1f giây",
        provider,
        tokens_in,
        tokens_out,
        stop,
        time.monotonic() - started,
    )


class Ollama:
    def __init__(self, client: httpx.Client | None = None):
        self._client = client or httpx.Client(base_url=settings.ollama_url)
        self.info = ModelInfo(name=settings.model, provider="ollama", location="local", host=None)

    def generate(self, question: str, sentences: list[Sentence]) -> dict:
        content = self.chat(
            answer_messages(question, sentences), ANSWER_SCHEMA, "answer", settings.timeout_seconds
        )
        return parse_reply(content, "Ollama")

    def chat(self, messages: list[dict], schema: dict, name: str, timeout: float) -> str | None:
        """Nội dung mô hình sinh theo `schema`, hay None khi phản hồi không có nội dung.

        `name` chỉ có nghĩa với API tương thích OpenAI; Ollama nhận JSON Schema trần ở `format`."""
        body = {
            "model": settings.model,
            "messages": messages,
            "format": schema,
            "stream": False,
            # Không cho mô hình viết phần suy nghĩ trước câu trả lời: tốn thời gian sinh mà không được dùng.
            "think": False,
            "options": {"temperature": 0, "num_predict": settings.num_predict},
        }
        started = time.monotonic()
        response = self._post(body, timeout)
        try:
            payload = response.json()
        except ValueError:
            payload = None
        if not isinstance(payload, dict):
            log.error("Ollama trả nội dung không phải JSON: %s", response.text[:2000])
            return None
        stop = payload.get("done_reason")
        log_call("ollama", payload.get("prompt_eval_count"), payload.get("eval_count"), stop, started)
        if stop == "length":
            raise Denied(502, TRUNCATED)
        message = payload.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        return content if isinstance(content, str) else None

    def _post(self, body: dict, timeout: float) -> httpx.Response:
        try:
            response = self._client.post("/api/chat", json=body, timeout=timeout)
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
        return response


def parse_reply(content: str | None, source: str) -> dict:
    """Câu trả lời từ chuỗi JSON mô hình sinh; sai dạng là 502, cùng cách với mọi nhà cung cấp."""
    reply = load_json(content, source)
    if not _well_formed(reply):
        raise malformed(content, source)
    return reply


def load_json(content: str | None, source: str) -> object:
    try:
        return json.loads(content) if isinstance(content, str) else None
    except ValueError:
        return None


def malformed(content: str | None, source: str) -> Denied:
    # Nội dung là chữ mô hình sinh, không chứa prompt; ghi ở mức ERROR để người vận hành thấy vì sao.
    log.error("%s trả nội dung không đúng dạng: %s", source, (content or "(không có nội dung)")[:2000])
    return Denied(502, MALFORMED)


def _well_formed(reply: object) -> bool:
    return (
        isinstance(reply, dict)
        and isinstance(reply.get("answerable"), bool)
        and isinstance(reply.get("answer"), str)
        and isinstance(reply.get("sentences"), list)
        and all(isinstance(item, str) for item in reply["sentences"])
    )
