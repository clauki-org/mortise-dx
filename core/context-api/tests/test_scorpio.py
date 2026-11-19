# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử cách đọc phản hồi của Scorpio bằng một máy chủ giả trong tiến trình (httpx.MockTransport): tenant
# chưa có dữ liệu là danh sách rỗng, lỗi nội bộ của Scorpio không lộ ra client.

import httpx
import pytest

from app import scorpio
from app.policy import Denied

TENANT_NOT_FOUND = {
    "type": "https://uri.etsi.org/ngsi-ld/errors/TenantNotFound",
    "title": "Tenant not found.",
}


def answer(monkeypatch, status: int, body: object = None, text: str | None = None) -> list[httpx.Request]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if text is not None:
            return httpx.Response(status, text=text)
        return httpx.Response(status, json=body)

    client = httpx.Client(base_url="http://scorpio/ngsi-ld/v1", transport=httpx.MockTransport(handler))
    monkeypatch.setattr(scorpio, "_client", client)
    return seen


def test_tenant_header_is_set_from_argument(monkeypatch):
    seen = answer(monkeypatch, 200, [])
    scorpio.entities("xa-a", {"type": "Device"})
    assert seen[0].headers["NGSILD-Tenant"] == "xa-a"


def test_tenant_without_data_reads_as_empty_list(monkeypatch):
    answer(monkeypatch, 404, TENANT_NOT_FOUND)
    assert scorpio.entities("xa-a", {}) == []


def test_internal_error_text_is_not_returned(monkeypatch):
    answer(monkeypatch, 500, text="org.postgresql.util.PSQLException: relation secret_table ...")
    with pytest.raises(Denied) as denied:
        scorpio.entities("xa-a", {})
    assert denied.value.status == 502
    assert "PSQL" not in denied.value.reason and "secret_table" not in denied.value.reason


def test_non_list_answer_is_a_gateway_error(monkeypatch):
    answer(monkeypatch, 200, {"unexpected": True})
    with pytest.raises(Denied) as denied:
        scorpio.entities("xa-a", {})
    assert denied.value.status == 502
