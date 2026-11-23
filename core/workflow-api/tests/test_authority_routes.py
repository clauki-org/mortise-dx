# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử bảng phân cấp thẩm quyền qua route (ADR 0028): lúc khởi tạo, biến `authority_<bước>` lấy từ bảng
# của tenant, client không tự đặt được; lúc hoàn thành, bước đọc bảng cần OTP với mọi vai trò. Flowable và
# CSDL được thay bằng bản giả.

import pytest
from fastapi.testclient import TestClient

from app import db, flowable
from app.auth import caller_from_token
from app.authority import Row
from app.main import app
from app.policy import Caller

ADMIN_A = Caller(
    sub="a-a",
    username="admin.a",
    tenant="xa-a",
    roles=frozenset({"user", "tenant_admin"}),
    methods=frozenset({"pwd"}),
)
START = "/v1/workflow/processes/core-authority/instances"
COMPLETE = "/v1/workflow/tasks/t1/complete"


@pytest.fixture
def stack(monkeypatch) -> dict:
    """Biến tới Flowable, các lần đọc CSDL, và các dòng của bảng mà CSDL giả trả về."""
    state: dict = {
        "sent": [],
        "reads": [],
        "parent": "tinh-mau",
        "rows": {
            "decide": [Row("default", None, None, "manager"), Row("large", "amount", 1000.0, "tenant_admin")]
        },
        "task_variables": [{"name": "authority_decide", "value": "tenant_admin"}],
        "caller": ADMIN_A,
    }

    def authorities(tenant, process, steps):
        state["reads"].append((tenant, process, steps))
        return state["parent"], state["rows"]

    def start(_key, _tenant, variables):
        state["sent"].append(variables)
        return {"id": "p1"}

    def task(_id):
        return {
            "id": "t1",
            "tenantId": "xa-a",
            "assignee": None,
            "category": None,
            "processDefinitionId": "core-authority:1:a",
            "taskDefinitionKey": "decide",
            "variables": state["task_variables"],
        }

    monkeypatch.setattr(db, "authorities", authorities)
    monkeypatch.setattr(flowable, "start", start)
    monkeypatch.setattr(
        flowable, "definition", lambda _key, _tenant: flowable.Definition(frozenset(), frozenset({"decide"}))
    )
    monkeypatch.setattr(
        flowable, "definition_of", lambda _id: flowable.Definition(frozenset(), frozenset({"decide"}))
    )
    monkeypatch.setattr(flowable, "task", task)
    monkeypatch.setattr(flowable, "candidate_groups", lambda _id: frozenset({"tenant_admin"}))
    monkeypatch.setattr(
        flowable, "claim_and_complete", lambda _id, _sub, variables: state["sent"].append(variables)
    )
    monkeypatch.setitem(app.dependency_overrides, caller_from_token, lambda: state["caller"])
    return state


client = TestClient(app)


@pytest.mark.parametrize(("amount", "role"), [(10, "manager"), (5000, "tenant_admin")])
def test_start_sets_the_role_chosen_by_the_table(stack, amount, role):
    response = client.post(START, json={"variables": {"amount": amount}})
    assert response.status_code == 201
    assert stack["sent"][0]["authority_decide"] == role
    assert stack["reads"] == [("xa-a", "core-authority", frozenset({"decide"}))]


def test_start_without_a_row_for_the_step_is_409(stack):
    stack["rows"] = {}
    response = client.post(START, json={"variables": {"amount": 10}})
    assert response.status_code == 409
    assert "bảng phân cấp" in response.json()["error"]
    assert stack["sent"] == []


def test_process_without_authority_steps_does_not_read_the_database(stack, monkeypatch):
    monkeypatch.setattr(
        flowable, "definition", lambda _key, _tenant: flowable.Definition(frozenset(), frozenset())
    )
    assert client.post(START, json={"variables": {"amount": 10}}).status_code == 201
    assert stack["reads"] == []


@pytest.mark.parametrize("path", [START, COMPLETE])
def test_client_cannot_set_an_authority_variable(stack, path):
    response = client.post(path, json={"variables": {"authority_decide": "user"}})
    assert response.status_code == 400
    assert "authority_" in response.json()["error"]
    assert stack["sent"] == []


def test_authority_step_needs_a_second_factor_whatever_the_role(stack):
    response = client.post(COMPLETE, json={"variables": {}})
    assert response.status_code == 403
    assert "OTP" in response.json()["error"]
    stack["caller"] = Caller(**(ADMIN_A.__dict__ | {"methods": frozenset({"pwd", "otp"})}))
    assert client.post(COMPLETE, json={"variables": {}}).status_code == 204


def test_step_with_a_literal_role_keeps_password_login_for_non_managers(stack):
    stack["task_variables"] = []
    assert client.post(COMPLETE, json={"variables": {}}).status_code == 204
