# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Đọc entity từ Scorpio (broker NGSI-LD, ADR 0012) trong một tenant. Chỉ module này biết đường dẫn
# và lỗi của Scorpio; Scorpio không có cổng ra ngoài trừ qua lớp này.

import logging

import httpx

from .config import settings
from .policy import Denied

_client = httpx.Client(base_url=f"{settings.scorpio_url}/ngsi-ld/v1", timeout=10)
log = logging.getLogger("context-api.scorpio")

# Scorpio tạo CSDL của một tenant ở lần ghi đầu tiên; tenant chưa có thiết bị nào gửi số đo thì
# đọc sẽ nhận lỗi này. Với người dùng, đó là "chưa có dữ liệu", không phải lỗi.
_TENANT_NOT_FOUND = "https://uri.etsi.org/ngsi-ld/errors/TenantNotFound"


def _get(path: str, tenant: str, params: dict[str, str] | None = None) -> httpx.Response:
    try:
        return _client.get(
            path, params=params, headers={"NGSILD-Tenant": tenant, "Accept": "application/json"}
        )
    except httpx.HTTPError as error:
        log.error("Không kết nối được Scorpio: %s", error)
        raise Denied(
            503, "Không kết nối được kho dữ liệu thiết bị; báo người vận hành kiểm tra `make ps`."
        ) from error


def _problem(response: httpx.Response) -> dict:
    try:
        body = response.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def _unexpected(response: httpx.Response) -> Denied:
    # Nội dung lỗi của Scorpio có thể có chi tiết nội bộ (câu SQL, stack trace): ghi log, không trả
    # cho client.
    log.error("Scorpio trả %s: %s", response.status_code, response.text[:2000])
    return Denied(502, "Kho dữ liệu thiết bị trả lỗi; báo người vận hành xem log của context-api.")


def _fail(response: httpx.Response) -> Denied:
    if response.status_code == 400:
        # Lỗi do truy vấn của người gọi (ví dụ cú pháp q): mô tả ngắn theo NGSI-LD, có ích để sửa truy vấn.
        detail = str(_problem(response).get("detail") or "")[:200]
        return Denied(400, f"Truy vấn không hợp lệ: {detail}" if detail else "Truy vấn không hợp lệ.")
    return _unexpected(response)


def _json(response: httpx.Response, kind: type) -> list | dict:
    try:
        body = response.json()
    except ValueError:
        raise _unexpected(response) from None
    if not isinstance(body, kind):
        raise _unexpected(response)
    return body


def entities(tenant: str, params: dict[str, str]) -> list[dict]:
    response = _get("/entities", tenant, params)
    if response.status_code == 404 and _problem(response).get("type") == _TENANT_NOT_FOUND:
        return []
    if not response.is_success:
        raise _fail(response)
    return _json(response, list)


def entity(tenant: str, entity_id: str) -> dict:
    response = _get(f"/entities/{entity_id}", tenant)
    if response.status_code == 404:
        # Cùng câu trả lời cho entity không có và tenant chưa có dữ liệu: không lộ gì thêm.
        raise Denied(404, "Không tìm thấy entity.")
    if not response.is_success:
        raise _fail(response)
    return _json(response, dict)


def history(tenant: str, entity_id: str, params: dict[str, str]) -> dict:
    response = _get(f"/temporal/entities/{entity_id}", tenant, params)
    if response.status_code == 404:
        # Như entity(): entity không có, số đo chưa có lần đo nào, hay tenant chưa có dữ liệu đều trả cùng
        # một câu.
        raise Denied(404, "Không tìm thấy lịch sử của entity hay số đo này.")
    if not response.is_success:
        raise _fail(response)
    return _json(response, dict)
