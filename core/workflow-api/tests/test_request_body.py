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
from app.policy import Caller

MANAGER_A = Caller(sub="m-a", username="manager.a", tenant="xuong-a", roles=frozenset({"user", "manager"}))
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

    task = {"id": "t1", "tenantId": "xuong-a", "assignee": None, "category": None, "variables": []}
    monkeypatch.setattr(flowable, "task", lambda _id: task)
    monkeypatch.setattr(flowable, "candidate_groups", lambda _id: frozenset({"manager"}))
    monkeypatch.setattr(flowable, "claim_and_complete", complete)
    monkeypatch.setattr(flowable, "start", start)
    monkeypatch.setitem(app.dependency_overrides, caller_from_token, lambda: MANAGER_A)
    return calls


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


def test_body_that_is_not_an_object_is_rejected(sent):
    response = client.post(COMPLETE, json=["approved"])
    assert response.status_code == 422
    assert sent == []


@pytest.mark.parametrize("kwargs", [{}, {"json": {}}, {"json": {"variables": None}}])
def test_missing_variables_mean_no_variables(sent, kwargs):
    response = client.post(COMPLETE, **kwargs)
    assert response.status_code == 204
    assert sent == [{}]
