# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử hình dạng thân request của API quy trình: chỉ nhận {"variables": {...}} hoặc
# không có thân. Flowable và việc kiểm token được thay bằng bản giả; test ghi lại biến mà
# lớp API chuyển cho Flowable.

import pytest
from fastapi.testclient import TestClient

from app import flowable
from app.auth import caller_from_token
from app.main import app
from app.policy import Caller, Denied

MANAGER_A = Caller(
    sub="m-a",
    username="manager.a",
    tenant="xa-a",
    roles=frozenset({"user", "manager"}),
    methods=frozenset({"pwd", "otp"}),
)
COMPLETE = "/v1/workflow/tasks/t1/complete"
START = "/v1/workflow/processes/core-approval/instances"


@pytest.fixture
def sent(monkeypatch) -> list[dict]:
    """Biến của mỗi lời gọi đã tới Flowable; rỗng nếu lớp API chặn trước đó."""
    calls: list[dict] = []

    def complete(_task_id, _assignee, variables):
        calls.append(variables)

    def start(_key, _tenant, variables):
        calls.append(variables)
        return {"id": "p1"}

    task = {
        "id": "t1",
        "tenantId": "xa-a",
        "assignee": None,
        "category": None,
        "processDefinitionId": "core-approval:1:a",
        "taskDefinitionKey": "review",
        "variables": [],
    }
    monkeypatch.setattr(flowable, "task", lambda _id: task)
    monkeypatch.setattr(flowable, "candidate_groups", lambda _id: frozenset({"manager"}))
    monkeypatch.setattr(flowable, "claim_and_complete", complete)
    monkeypatch.setattr(flowable, "start", start)
    monkeypatch.setattr(flowable, "definition", lambda _key, _tenant: _definition({"approved"}))
    monkeypatch.setattr(flowable, "definition_of", lambda _id: _definition({"approved"}))
    monkeypatch.setitem(app.dependency_overrides, caller_from_token, lambda: MANAGER_A)
    return calls


def _definition(decisions: set[str] = frozenset(), authorities: set[str] = frozenset()):
    return flowable.Definition(frozenset(decisions), frozenset(authorities))


client = TestClient(app)


def test_variables_reach_flowable(sent):
    response = client.post(COMPLETE, json={"variables": {"approved": True}})
    assert response.status_code == 204
    assert sent == [{"approved": True}]


@pytest.mark.parametrize("body", [{"approved": True}, {"variables": {"approved": True}, "comment": "x"}])
def test_unknown_key_on_complete_is_rejected(sent, body):
    response = client.post(COMPLETE, json=body)
    assert response.status_code == 422
    assert "khóa lạ" in response.json()["error"]
    assert sent == []


def test_unknown_key_on_start_is_rejected(sent):
    response = client.post(START, json={"title": "Yêu cầu mẫu"})
    assert response.status_code == 422
    assert "title" in response.json()["error"]
    assert sent == []


def test_start_cannot_preset_a_decision(sent):
    response = client.post(START, json={"variables": {"title": "Yêu cầu mẫu", "approved": True}})
    assert response.status_code == 400
    assert "approved" in response.json()["error"]
    assert sent == []


def test_start_stops_when_decisions_cannot_be_read(sent, monkeypatch):
    def unreadable(_key, _tenant):
        raise Denied(502, "Không đọc được BPMN")

    monkeypatch.setattr(flowable, "definition", unreadable)
    response = client.post(START, json={"variables": {"title": "Yêu cầu mẫu"}})
    assert response.status_code == 502
    assert sent == []


def test_start_with_other_variables_reaches_flowable(sent):
    response = client.post(START, json={"variables": {"title": "Yêu cầu mẫu"}})
    assert response.status_code == 201
    assert sent[0]["title"] == "Yêu cầu mẫu"


def test_completing_still_sends_the_decision(sent):
    response = client.post(COMPLETE, json={"variables": {"approved": False}})
    assert response.status_code == 204
    assert sent == [{"approved": False}]


def test_body_that_is_not_an_object_is_rejected(sent):
    response = client.post(COMPLETE, json=["approved"])
    assert response.status_code == 422
    assert sent == []


@pytest.mark.parametrize("kwargs", [{}, {"json": {}}, {"json": {"variables": None}}])
def test_missing_variables_mean_no_variables(sent, kwargs):
    response = client.post(COMPLETE, **kwargs)
    assert response.status_code == 204
    assert sent == [{}]
