# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử niêm phong hồ sơ và hạn của bước chờ (ADR 0053): đọc cờ trong BPMN, bản JSON chuẩn chỉ gồm trường
# của bước và lịch sử, băm không đổi theo cách viết thời điểm, niêm phong sau bước cuối với tenant của hồ sơ,
# bù khi xem, ghi hạn chỉ cho bước chờ, lỗi ghi không làm hỏng bước đã hoàn thành, `make seal-verify` báo đúng
# hồ sơ. Flowable và CSDL được thay bằng bản giả; dạng dữ liệu theo flowable-rest 7.2.0 (đã chạy thử, ADR
# 0053).

import logging

import httpx
import pytest
from fastapi.testclient import TestClient

from app import db, flowable, history, seal_verify, sealing
from app.auth import caller_from_token
from app.flowable import Definition
from app.main import app
from app.policy import Caller, Denied
from app.seal import VERSION, digest, document, seal_of

MANAGER_A = Caller(
    sub="m-a",
    username="manager.a",
    tenant="xa-a",
    roles=frozenset({"manager"}),
    methods=frozenset({"pwd", "otp"}),
)
SEALED = Definition(
    decisions=frozenset(),
    authorities=frozenset(),
    fields={"prepare": frozenset({"note"}), "confirm": frozenset({"confirmed"})},
    nodes={"prepare": ("task", "Chuẩn bị"), "hold": ("wait", "Chờ"), "done": ("end", "Xong")},
    seal=True,
)
ENDED = {
    "id": "p1",
    "processDefinitionId": "core-sealed:1:d1",
    "tenantId": "xa-a",
    "startTime": "2026-11-27T13:50:03.900Z",
    "endTime": "2026-11-27T13:50:20.023Z",
    "endActivityId": "done",
    "deleteReason": None,
    "variables": [
        {"name": "note", "type": "string", "value": "Ghi chú có dấu"},
        {"name": "confirmed", "type": "boolean", "value": True},
        {"name": "title", "type": "string", "value": "Hồ sơ"},
        {"name": "initiator", "type": "string", "value": "u-a"},
    ],
}
TASKS = [
    {
        "taskDefinitionKey": "prepare",
        "startTime": "2026-11-27T13:50:03.920Z",
        "endTime": "2026-11-27T13:50:04.027Z",
        "assignee": "u-a",
        "deleteReason": None,
    },
    {
        "taskDefinitionKey": "confirm",
        "startTime": "2026-11-27T13:50:17.480Z",
        "endTime": "2026-11-27T13:50:20.011Z",
        "assignee": "m-a",
        "deleteReason": None,
    },
]
WAITS = [
    {"activityId": "hold", "startTime": "2026-11-27T13:50:04.030Z", "endTime": "2026-11-27T13:50:17.470Z"}
]


def bpmn(attributes: str) -> bytes:
    return (
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:mortise="https://mortise-dx/bpmn">'
        f'<process id="p" {attributes}/></definitions>'
    ).encode()


@pytest.mark.parametrize(
    ("attributes", "expected"), [("", False), ('mortise:seal="false"', False), ('mortise:seal="true"', True)]
)
def test_seal_flag_is_read_from_the_process(attributes, expected):
    assert seal_of(bpmn(attributes), "p") is expected


def test_seal_flag_other_than_true_or_false_is_refused():
    with pytest.raises(ValueError, match="chỉ nhận true hoặc false"):
        seal_of(bpmn('mortise:seal="yes"'), "p")


def test_document_keeps_only_step_fields_and_history():
    doc = document(ENDED, "core-sealed", {"note", "confirmed"}, TASKS, WAITS)
    assert doc["variables"] == {"note": "Ghi chú có dấu", "confirmed": True}
    assert [(s["step"], s["kind"]) for s in doc["steps"]] == [
        ("prepare", "task"),
        ("hold", "wait"),
        ("confirm", "task"),
    ]
    assert (doc["tenant"], doc["outcome"], doc["version"]) == ("xa-a", "done", VERSION)


def test_digest_does_not_depend_on_how_flowable_writes_time():
    shifted = {**ENDED, "endTime": "2026-11-27T20:50:20.023+07:00"}
    same = document(shifted, "core-sealed", {"note", "confirmed"}, TASKS, WAITS)
    assert digest(same) == digest(document(ENDED, "core-sealed", {"note", "confirmed"}, TASKS, WAITS))


def test_digest_changes_when_a_step_field_is_edited():
    edited = {**ENDED, "variables": [{**ENDED["variables"][0], "value": "sửa lén"}, *ENDED["variables"][1:]]}
    fields = {"note", "confirmed"}
    assert digest(document(edited, "core-sealed", fields, TASKS, WAITS)) != digest(
        document(ENDED, "core-sealed", fields, TASKS, WAITS)
    )


@pytest.fixture
def fake(monkeypatch) -> dict:
    """Flowable và CSDL giả cho một hồ sơ core-sealed đã kết thúc; ghi lại dòng đã ghi vào CSDL."""
    state: dict = {"seals": {}, "deadlines": [], "instance": ENDED, "jobs": []}

    def call(_method, path, json=None, **_):
        found = [state["instance"]] if state["instance"] and json["processInstanceId"] == "p1" else []
        assert path == "/query/historic-process-instances"
        return httpx.Response(200, json={"data": found, "total": len(found)})

    def insert_seal(case, tenant, process, version, value, actor):
        state["seals"].setdefault(case, {"tenant": tenant, "process": process, "hash": value, "actor": actor})

    monkeypatch.setattr(flowable, "_call", call)
    monkeypatch.setattr(flowable, "definition_of", lambda _id: SEALED)
    monkeypatch.setattr(flowable, "process_key", lambda _id: "core-sealed")
    monkeypatch.setattr(flowable, "instance", lambda _id: state["instance"])
    monkeypatch.setattr(flowable, "timer_jobs", lambda _id: state["jobs"])
    monkeypatch.setattr(history, "task_history", lambda _id, complete: TASKS)
    monkeypatch.setattr(history, "wait_history", lambda _id, complete: WAITS)
    monkeypatch.setattr(db, "insert_seal", insert_seal)
    monkeypatch.setattr(db, "insert_deadlines", lambda rows: state["deadlines"].extend(rows))
    monkeypatch.setattr(
        db,
        "seal",
        lambda case: (
            {"hash": state["seals"][case]["hash"], "sealed_at": "t", "version": 1}
            if case in state["seals"]
            else None
        ),
    )
    return state


def test_last_step_seals_with_the_tenant_of_the_case(fake):
    sealing.after_step("p1", SEALED, "m-tinh")
    row = fake["seals"]["p1"]
    expected = digest(document(ENDED, "core-sealed", {"note", "confirmed"}, TASKS, WAITS)).hex()
    assert row == {"tenant": "xa-a", "process": "core-sealed", "hash": expected, "actor": "m-tinh"}


def test_open_or_deleted_case_is_not_sealed(fake):
    fake["instance"] = {**ENDED, "endTime": None, "endActivityId": None}
    sealing.after_step("p1", SEALED, "u-a")
    fake["instance"] = {**ENDED, "endActivityId": None, "deleteReason": "process instance deleted"}
    sealing.after_step("p1", SEALED, "u-a")
    assert fake["seals"] == {}


def test_deadlines_are_recorded_only_for_wait_nodes_of_this_case(fake):
    fake["instance"] = {**ENDED, "endTime": None, "endActivityId": None}
    job = {"processInstanceId": "p1", "processDefinitionId": "core-sealed:1:d1", "tenantId": "xa-a"}
    fake["jobs"] = [
        {**job, "elementId": "hold", "dueDate": "2026-11-27T13:50:05.033Z"},
        # Hẹn giờ của sự kiện biên gắn vào userTask: không phải bước chờ.
        {**job, "elementId": "prepare_timeout", "dueDate": "2026-11-28T13:50:05.033Z"},
    ]
    sealing.after_step("p1", SEALED, "u-a")
    assert fake["deadlines"] == [
        {
            "case": "p1",
            "tenant": "xa-a",
            "process": "core-sealed",
            "activity": "hold",
            "due": "2026-11-27T13:50:05.033Z",
        }
    ]


def test_timer_jobs_of_other_cases_are_dropped(monkeypatch):
    jobs = [
        {"processInstanceId": "p1", "elementId": "hold"},
        {"processInstanceId": "p2", "elementId": "hold"},
    ]
    monkeypatch.setattr(flowable, "_call", lambda *_a, **_k: httpx.Response(200, json={"data": jobs}))
    assert flowable.timer_jobs("p1") == jobs[:1]


def test_write_failure_is_logged_not_raised(fake, monkeypatch, caplog):
    def down(*_):
        raise Denied(503, "Không ghi được dòng niêm phong")

    monkeypatch.setattr(db, "insert_seal", down)
    with caplog.at_level(logging.ERROR, logger="workflow-api.sealing"):
        sealing.after_step("p1", SEALED, "m-a")
    assert "p1" in caplog.text


def test_status_backfills_a_case_that_ended_without_seal(fake):
    found = sealing.status(ENDED, SEALED)
    assert found["hash"] == fake["seals"]["p1"]["hash"]
    assert fake["seals"]["p1"]["actor"] is None


def test_status_of_unsealed_process_does_not_touch_the_database(fake, monkeypatch):
    monkeypatch.setattr(db, "seal", lambda _case: pytest.fail("không được đọc CSDL"))
    assert sealing.status(ENDED, Definition(frozenset(), frozenset())) is None


def test_instance_route_returns_the_seal(fake, monkeypatch):
    monkeypatch.setitem(app.dependency_overrides, caller_from_token, lambda: MANAGER_A)
    body = TestClient(app).get("/v1/workflow/instances/p1").json()
    assert body["seal"]["hash"] == fake["seals"]["p1"]["hash"]


def test_completing_an_untracked_process_skips_sealing(monkeypatch):
    task = {
        "id": "t1",
        "tenantId": "xa-a",
        "processDefinitionId": "core-approval:1:a",
        "taskDefinitionKey": "review",
        "variables": [],
    }
    monkeypatch.setattr(flowable, "task", lambda _id: task)
    monkeypatch.setattr(flowable, "candidate_groups", lambda _id: frozenset({"manager"}))
    monkeypatch.setattr(flowable, "claim_and_complete", lambda *_: None)
    monkeypatch.setattr(flowable, "definition_of", lambda _id: Definition(frozenset(), frozenset()))
    monkeypatch.setattr(sealing, "after_step", lambda *_: pytest.fail("không được niêm phong"))
    monkeypatch.setitem(app.dependency_overrides, caller_from_token, lambda: MANAGER_A)
    assert TestClient(app).post("/v1/workflow/tasks/t1/complete").status_code == 204


def test_seal_verify_reports_edited_and_missing_history(fake):
    sealing.after_step("p1", SEALED, "m-a")
    sealed = fake["seals"]["p1"]["hash"]
    assert seal_verify.problem("p1", VERSION, sealed) is None
    assert "đã bị sửa" in seal_verify.problem("p1", VERSION, "00" * 32)
    assert "phiên bản" in seal_verify.problem("p1", VERSION + 1, sealed)
    fake["instance"] = None
    assert "không còn lịch sử" in seal_verify.problem("p1", VERSION, sealed)


def test_sealing_refuses_a_truncated_history(monkeypatch):
    monkeypatch.setattr(flowable, "MAX_PAGES", 1)

    def call(_method, _path, json):
        return httpx.Response(200, json={"data": [{"processInstanceId": "p1"}] * json["size"], "total": 500})

    monkeypatch.setattr(flowable, "_call", call)
    with pytest.raises(Denied) as refused:
        history.task_history("p1", complete=True)
    assert refused.value.status == 502
