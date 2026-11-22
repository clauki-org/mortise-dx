# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Chọn nhà cung cấp mô hình theo ASSISTANT_LLM_PROVIDER (bổ sung của ADR 0021): `ollama` (mặc định, tại chỗ, ở
# model.py) hay `openai-compatible` (POST {ASSISTANT_LLM_BASE_URL}/chat/completions với `response_format` là
# JSON Schema). Cả hai trả cùng một dict cho pipeline.py, nên tìm đoạn, kiểm câu trích, kiểm số, từ chối và
# nhật ký không biết mô hình chạy ở đâu. Khai thiếu hay sai thì không đổi sang nhà cung cấp khác: mọi câu hỏi
# cần mô hình nhận 503 chỉ biến cần sửa, để người vận hành không tưởng câu hỏi vẫn ở lại máy chủ khi đã chọn
# API, hay ngược lại.

import logging

import httpx

from .config import settings
from .errors import Denied
from .model import ANSWER_SCHEMA, SYSTEM, TOO_SLOW, Model, Ollama, parse_reply, prompt
from .retrieval import Sentence
from .schemas import ModelInfo

log = logging.getLogger("assistant.model")

API = "openai-compatible"
API_VARIABLES = ("ASSISTANT_LLM_BASE_URL", "ASSISTANT_LLM_MODEL", "ASSISTANT_LLM_API_KEY")


class OpenAICompatible:
    def __init__(self, base_url: str, model: str, api_key: str, client: httpx.Client | None = None):
        # httpx nối đường dẫn tương đối vào sau đường dẫn của base_url, có hay không có "/" ở cuối.
        self._client = client or httpx.Client(base_url=base_url)
        self._model, self._key = model, api_key
        host = httpx.URL(base_url).host
        self.info = ModelInfo(name=model, provider=API, location="api", host=host)
        self._unreachable = (
            f"Không kết nối được API mô hình {host}; người vận hành kiểm ASSISTANT_LLM_BASE_URL và đường ra "
            "mạng ngoài của máy chủ."
        )

    def generate(self, question: str, sentences: list[Sentence]) -> dict:
        body = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": prompt(question, sentences)},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "answer", "strict": True, "schema": ANSWER_SCHEMA},
            },
            "temperature": 0,
            # `max_tokens` thay vì `max_completion_tokens`: tên cũ được nhiều máy chủ tương thích nhận
            # hơn. Máy chủ nào từ chối thì trả 400, log bên dưới ghi lý do của nó.
            "max_tokens": settings.num_predict,
        }
        # Khóa chỉ nằm ở header của từng yêu cầu, không ở client: log hay lỗi in client ra cũng không lộ khóa.
        headers = {"Authorization": f"Bearer {self._key}"}
        try:
            response = self._client.post(
                "chat/completions", json=body, headers=headers, timeout=settings.timeout_seconds
            )
        except (httpx.ConnectError, httpx.ConnectTimeout) as error:
            log.warning("Không kết nối được API mô hình: %s", self._scrub(str(error)))
            raise Denied(503, self._unreachable) from error
        except httpx.TimeoutException as error:
            raise Denied(504, TOO_SLOW) from error
        except httpx.HTTPError as error:
            log.error("Không gọi được API mô hình: %s", self._scrub(str(error)))
            raise Denied(503, self._unreachable) from error
        if not response.is_success:
            raise self._refused(response)
        try:
            content = response.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError):
            content = None
        # Máy chủ bỏ qua `response_format`, cắt câu trả lời vì hết token, hay từ chối sinh (content null)
        # đều về cùng lỗi 502 như Ollama trả sai dạng.
        return parse_reply(content, "API mô hình", self._scrub(response.text))

    def _refused(self, response: httpx.Response) -> Denied:
        status = response.status_code
        # Thân lỗi của API có thể nhắc lại một phần khóa; xóa khóa trước khi ghi log.
        log.error("API mô hình trả %s: %s", status, self._scrub(response.text)[:2000])
        if status in (401, 403):
            return Denied(503, "API mô hình từ chối khóa; người vận hành kiểm ASSISTANT_LLM_API_KEY.")
        if status == 404:
            return Denied(
                503,
                f"API mô hình không có mô hình {self._model}; người vận hành kiểm ASSISTANT_LLM_MODEL và "
                "ASSISTANT_LLM_BASE_URL.",
            )
        if status == 429:
            return Denied(503, "API mô hình đang giới hạn tần suất hay đã hết hạn mức; thử lại sau ít phút.")
        return Denied(502, "API mô hình trả lỗi; báo người vận hành xem log của assistant.")

    def _scrub(self, text: str) -> str:
        return text.replace(self._key, "***") if self._key else text


class Unconfigured:
    """Nhà cung cấp khai sai: mọi câu hỏi cần mô hình nhận 503 chỉ cách sửa, không gọi mô hình nào."""

    info: ModelInfo | None = None

    def __init__(self, problem: str):
        self.problem = problem

    def generate(self, question: str, sentences: list[Sentence]) -> dict:
        raise Denied(503, self.problem)


def configured() -> Model:
    """Nhà cung cấp theo cấu hình; gọi một lần lúc khởi động để lỗi cấu hình hiện ngay trong log."""
    if settings.llm_provider == "ollama":
        return Ollama()
    if settings.llm_provider != API:
        return _unconfigured(
            f"ASSISTANT_LLM_PROVIDER là {settings.llm_provider!r}, chỉ nhận ollama hoặc {API}; người vận "
            "hành sửa trong .env rồi chạy make up."
        )
    values = (settings.llm_base_url, settings.model, settings.llm_api_key)
    missing = [name for name, value in zip(API_VARIABLES, values, strict=True) if not value]
    if missing:
        return _unconfigured(
            f"Trợ lý được cấu hình gọi mô hình qua API nhưng thiếu {', '.join(missing)}; người vận hành khai "
            "trong .env rồi chạy make up."
        )
    if not settings.llm_base_url.startswith(("http://", "https://")) or not settings.llm_host:
        return _unconfigured(
            "ASSISTANT_LLM_BASE_URL phải là địa chỉ http:// hay https:// có tên máy; người vận hành sửa "
            "trong .env rồi chạy make up."
        )
    try:
        chosen = OpenAICompatible(settings.llm_base_url, settings.model, settings.llm_api_key)
    # httpx kiểm địa chỉ chặt hơn urlsplit (ví dụ cổng không phải số); để lọt thì dịch vụ dừng lúc import.
    except httpx.InvalidURL as error:
        return _unconfigured(
            f"ASSISTANT_LLM_BASE_URL không hợp lệ ({error}); người vận hành sửa trong .env rồi chạy make up."
        )
    # WARNING để luôn hiện trong log khi khởi động: người vận hành thấy dữ liệu đang đi ra ngoài và đi đâu.
    log.warning(
        "Trợ lý gửi câu hỏi và các câu đã tìm tới API %s, mô hình %s (ADR 0021).",
        settings.llm_host,
        settings.model,
    )
    return chosen


def _unconfigured(problem: str) -> Unconfigured:
    log.error("Cấu hình mô hình sai: %s", problem)
    return Unconfigured(problem)
