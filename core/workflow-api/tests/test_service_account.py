# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử tài khoản dịch vụ (ADR 0017): nhận diện từ claim của token, tenant lấy từ header, chỉ được mở quy
# trình, và mã chống trùng chỉ khớp quy trình còn mở. Flowable được thay bằng bản giả.

import pytest
from fastapi.testclient import TestClient

from app import flowable
from app.auth import caller_from_claims, caller_from_token
from app.main import app
from app.policy import Caller, Denied

SERVICES = {"mortise-iot-bridge"}
SERVICE_CLAIMS = {"sub": "svc", "azp": "mortise-iot-bridge", "preferred_username": "service-account-x"}
USER_CLAIMS = {"sub": "u-a", "azp": "mortise-web", "tenant": ["xa-a"], "realm_access": {"roles": ["user"]}}
SERVICE = Caller(sub="svc", username="service-account-x", tenant="xa-a", roles=frozenset(), service=True)


def test_service_token_takes_tenant_from_header():
    caller = caller_from_claims(SERVICE_CLAIMS, "xa-b", SERVICES)
    assert (caller.tenant, caller.service, caller.roles) == ("xa-b", True, frozenset())


def test_service_roles_in_token_are_ignored():
    claims = SERVICE_CLAIMS | {"realm_access": {"roles": ["manager"]}}
    assert caller_from_claims(claims, "xa-a", SERVICES).roles == frozenset()


@pytest.mark.parametrize("tenant", [None, "", "XA-A", "xa-a/../x", "xa a"])
def test_service_token_needs_a_slug_tenant(tenant):
    with pytest.raises(Denied) as error:
        caller_from_claims(SERVICE_CLAIMS, tenant, SERVICES)
    assert error.value.status == 400


def test_user_cannot_choose_tenant_by_header():
    with pytest.raises(Denied) as error:
        caller_from_claims(USER_CLAIMS, "xa-b", SERVICES)
    assert error.value.status == 400


def test_client_not_configured_as_service_is_a_user():
    with pytest.raises(Denied) as error:
        caller_from_claims(SERVICE_CLAIMS, None, set())
    assert error.value.status == 403


def test_user_token_unchanged_without_header():
    caller = caller_from_claims(USER_CLAIMS, None, SERVICES)
    assert (caller.tenant, caller.service) == ("xa-a", False)


@pytest.fixture
def service(monkeypatch) -> list[dict]:
    calls: list[dict] = []

    def started_with(tenant, key, initiator, idempotency_key, *, open_only=False):
        calls.append({"lookup": (tenant, initiator, idempotency_key, open_only)})
        return None

    def start(_key, tenant, variables):
        calls.append({"start": tenant, "variables": variables})
        return {"id": "p1"}

    monkeypatch.setattr(flowable, "started_with", started_with)
    monkeypatch.setattr(flowable, "start", start)
    monkeypatch.setattr(flowable, "decisions", lambda _key, _tenant: frozenset())
    monkeypatch.setitem(app.dependency_overrides, caller_from_token, lambda: SERVICE)
    return calls


client = TestClient(app)


def test_service_lookup_matches_open_instances_only(service):
    response = client.post(
        "/v1/workflow/processes/core-approval/instances", headers={"Idempotency-Key": "rule-x__device-1"}
    )
    assert response.status_code == 201
    assert service[0] == {"lookup": ("xa-a", "svc", "rule-x__device-1", True)}
    assert service[1]["start"] == "xa-a"
    assert service[1]["variables"]["initiator"] == "svc"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/v1/workflow/tasks"),
        ("POST", "/v1/workflow/tasks/t1/complete"),
        ("GET", "/v1/workflow/instances/p1"),
    ],
)
def test_service_can_only_start(service, method, path):
    response = client.request(method, path)
    assert response.status_code == 403
    assert service == []
