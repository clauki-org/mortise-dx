# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử trường của bước (ADR 0031): đọc `flowable:formProperty` của từng userTask từ BPMN, người lập
# không gửi được trường của bước nào, người hoàn thành một bước không gửi được trường của bước khác, và
# workflow-api đọc BPMN của đúng phiên bản hồ sơ đang chạy, một lần cho mỗi phiên bản. Flowable được thay
# bằng bản giả.

import httpx
import pytest
from fastapi.testclient import TestClient

from app import flowable
from app.auth import caller_from_token
from app.fields import step_fields
from app.main import app
from app.policy import Caller, Denied, check_start_fields, check_step_fields

NS = 'xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:flowable="http://flowable.org/bpmn"'


def _bpmn(body: str, key: str = "p") -> bytes:
    return f'<definitions {NS}><process id="{key}">{body}</process></definitions>'.encode()


def _task(task_id: str, *names: str) -> str:
    props = "".join(f'<flowable:formProperty id="{name}"/>' for name in names)
    return f'<userTask id="{task_id}"><extensionElements>{props}</extensionElements></userTask>'


# Hai bước như quy trình rà soát của gói xã: `comment` do cả hai bước ghi, `decision` chỉ bước quyết định.
FIELDS = {
    "submit": frozenset({"comment", "submitted"}),
    "decide": frozenset({"comment", "decision", "decided"}),
}


def test_fields_are_read_per_user_task():
    bpmn = _bpmn(
        _task("submit", "comment", "submitted") + _task("decide", "decision") + '<userTask id="bare"/>'
    )
    assert step_fields(bpmn, "p") == {"submit": {"comment", "submitted"}, "decide": {"decision"}}


def test_fields_inside_a_sub_process_are_read():
    assert step_fields(_bpmn(f'<subProcess id="s">{_task("inner", "note")}</subProcess>'), "p") == {
        "inner": {"note"}
    }


def test_form_property_of_a_nested_element_or_another_process_is_not_a_field():
    # formProperty của startEvent là biểu mẫu khởi tạo, không phải trường của bước nào.
    start = (
        '<startEvent id="s"><extensionElements><flowable:formProperty id="title"/>'
        "</extensionElements></startEvent>"
    )
    other = f'<process id="q">{_task("t", "note")}</process>'
    bpmn = f"<definitions {NS}>" + f'<process id="p">{start}<userTask id="t"/></process>{other}</definitions>'
    assert step_fields(bpmn.encode(), "p") == {}


@pytest.mark.parametrize("bpmn", [b"<definitions", _bpmn("", key="other")])
def test_unreadable_bpmn_or_missing_process_raises(bpmn):
    with pytest.raises(ValueError):
        step_fields(bpmn, "p")


@pytest.mark.parametrize("name", ["comment", "decision", "submitted"])
def test_start_refuses_a_field_of_any_step(name):
    with pytest.raises(Denied) as error:
        check_start_fields({"title": "x", name: "v"}, FIELDS)
    assert error.value.status == 400
    assert name in error.value.reason


def test_start_refusal_names_every_step_that_owns_the_field():
    with pytest.raises(Denied) as error:
        check_start_fields({"comment": "x"}, FIELDS)
    assert "comment (bước decide, submit)" in error.value.reason


def test_start_allows_variables_that_belong_to_no_step():
    check_start_fields({"title": "x", "excessM2": 420}, FIELDS)


def test_completing_a_step_refuses_a_field_of_another_step():
    with pytest.raises(Denied) as error:
        check_step_fields({"recipient": "x", "decision": "Đồng ý"}, FIELDS, "submit")
    assert error.value.status == 400
    assert "decision (bước decide)" in error.value.reason
    assert "'submit'" in error.value.reason


def test_completing_a_step_allows_its_own_fields_shared_or_not_and_unclaimed_variables():
    check_step_fields({"comment": "x", "submitted": True, "excessM2": 0}, FIELDS, "submit")
    check_step_fields({"comment": "x", "decision": "y", "decided": True}, FIELDS, "decide")


def test_step_without_fields_still_refuses_fields_of_other_steps():
    with pytest.raises(Denied):
        check_step_fields({"decided": True}, FIELDS, "review")


MANAGER_A = Caller(
    sub="m-a",
    username="manager.a",
    tenant="xa-a",
    roles=frozenset({"user", "manager"}),
    methods=frozenset({"pwd", "otp"}),
)
client = TestClient(app)


@pytest.fixture
def routes(monkeypatch) -> dict:
    """Biến đã tới Flowable, bước của task đang hoàn thành, và mã định nghĩa route đã hỏi."""
    state: dict = {"sent": [], "step": "submit", "asked": []}
    definition = flowable.Definition(frozenset(), frozenset(), FIELDS)

    def definition_of(definition_id):
        state["asked"].append(definition_id)
        return definition

    def task(_id):
        return {
            "id": "t1",
            "tenantId": "xa-a",
            "assignee": None,
            "category": None,
            "processDefinitionId": "p:1:old",
            "taskDefinitionKey": state["step"],
            "variables": [],
        }

    monkeypatch.setattr(flowable, "definition", lambda _key, _tenant: definition)
    monkeypatch.setattr(flowable, "definition_of", definition_of)
    monkeypatch.setattr(flowable, "task", task)
    monkeypatch.setattr(flowable, "candidate_groups", lambda _id: frozenset({"manager"}))
    monkeypatch.setattr(flowable, "claim_and_complete", lambda _id, _sub, v: state["sent"].append(v))
    monkeypatch.setattr(flowable, "start", lambda _key, _tenant, v: state["sent"].append(v) or {"id": "p1"})
    monkeypatch.setitem(app.dependency_overrides, caller_from_token, lambda: MANAGER_A)
    return state


def test_start_route_refuses_a_step_field(routes):
    response = client.post("/v1/workflow/processes/p/instances", json={"variables": {"decision": "x"}})
    assert response.status_code == 400
    assert "decision" in response.json()["error"]
    assert routes["sent"] == []


def test_complete_route_refuses_another_steps_field_using_the_tasks_own_definition(routes):
    response = client.post("/v1/workflow/tasks/t1/complete", json={"variables": {"decision": "x"}})
    assert response.status_code == 400
    assert routes["sent"] == []
    assert routes["asked"] == ["p:1:old"]


def test_complete_route_sends_the_steps_own_fields(routes):
    routes["step"] = "decide"
    response = client.post(
        "/v1/workflow/tasks/t1/complete", json={"variables": {"decision": "x", "decided": True}}
    )
    assert response.status_code == 204
    assert routes["sent"] == [{"decision": "x", "decided": True}]


def test_complete_route_checks_permissions_before_fields(routes, monkeypatch):
    monkeypatch.setattr(flowable, "candidate_groups", lambda _id: frozenset({"tenant_admin"}))
    response = client.post("/v1/workflow/tasks/t1/complete", json={"variables": {"decision": "x"}})
    assert response.status_code == 403
    assert routes["asked"] == []


@pytest.fixture
def rest(monkeypatch) -> dict:
    """REST giả của Flowable: khóa của mỗi mã định nghĩa, BPMN, và các đường đã gọi."""
    state: dict = {"bpmn": _bpmn(_task("t", "note")), "calls": []}

    def call(method, path, **kwargs):
        state["calls"].append(path)
        if path.endswith("/resourcedata"):
            return httpx.Response(200, content=state["bpmn"])
        return httpx.Response(200, json={"key": "p"})

    monkeypatch.setattr(flowable, "_call", call)
    monkeypatch.setattr(flowable, "_definitions", {})
    monkeypatch.setattr(flowable, "_process_keys", {})
    return state


def test_definition_of_reads_the_bpmn_once_per_definition(rest):
    assert flowable.definition_of("p:1:a").fields == {"t": {"note"}}
    assert flowable.definition_of("p:1:a").fields == {"t": {"note"}}
    assert sum(path.endswith("/resourcedata") for path in rest["calls"]) == 1
    rest["bpmn"] = _bpmn(_task("t", "remark"))
    assert flowable.definition_of("p:2:b").fields == {"t": {"remark"}}


def test_definition_of_refuses_when_the_bpmn_cannot_be_read(rest):
    rest["bpmn"] = b"<definitions"
    with pytest.raises(Denied) as error:
        flowable.definition_of("p:1:a")
    assert error.value.status == 502
