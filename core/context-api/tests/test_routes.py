# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử các đường của API: tenant gửi tới Scorpio luôn là tenant trong token, kể cả khi người gọi
# tự gửi header NGSILD-Tenant; Scorpio và việc kiểm token được thay bằng bản giả.

import pytest
from fastapi.testclient import TestClient

from app import scorpio
from app.auth import caller_from_token
from app.main import app
from app.policy import Caller

USER_A = Caller(sub="u-a", tenant="xuong-a")
client = TestClient(app)


@pytest.fixture
def calls(monkeypatch) -> list[tuple]:
    """Mỗi lời gọi đã tới Scorpio: (tenant, đối số); rỗng nếu lớp API chặn trước đó."""
    seen: list[tuple] = []

    def entities(tenant, params):
        seen.append((tenant, params))
        return [{"id": "urn:ngsi-ld:Device:kho-01", "type": "Device", "humidity": {"value": 78}}]

    def entity(tenant, entity_id):
        seen.append((tenant, entity_id))
        return {"id": entity_id, "type": "Device"}

    monkeypatch.setattr(scorpio, "entities", entities)
    monkeypatch.setattr(scorpio, "entity", entity)
    monkeypatch.setitem(app.dependency_overrides, caller_from_token, lambda: USER_A)
    return seen


def test_tenant_comes_from_token_not_from_header(calls):
    response = client.get(
        "/v1/context/entities", params={"type": "Device"}, headers={"NGSILD-Tenant": "xuong-b"}
    )
    assert response.status_code == 200
    assert calls == [("xuong-a", {"type": "Device"})]
    # Thuộc tính riêng của thiết bị giữ nguyên, không bị model cắt bỏ.
    assert response.json()[0]["humidity"] == {"value": 78}


def test_unknown_query_parameter_never_reaches_scorpio(calls):
    response = client.get("/v1/context/entities", params={"local": "false"})
    assert response.status_code == 400
    assert calls == []


def test_entity_by_id_uses_token_tenant(calls):
    response = client.get("/v1/context/entities/urn:ngsi-ld:Device:kho-01")
    assert response.status_code == 200
    assert calls == [("xuong-a", "urn:ngsi-ld:Device:kho-01")]


def test_malformed_entity_id_never_reaches_scorpio(calls):
    assert client.get("/v1/context/entities/kho-01").status_code == 400
    assert calls == []


def test_writes_are_not_routed(calls):
    for method in ("post", "patch", "delete"):
        response = getattr(client, method)("/v1/context/entities")
        assert response.status_code == 405
        assert "error" in response.json()
    assert calls == []


def test_unknown_path_answers_in_the_same_error_shape(calls):
    response = client.get("/v1/context/entities/urn:ngsi-ld:Device:a/b")
    assert response.status_code == 404
    assert response.json() == {"error": "Không có đường này."}
