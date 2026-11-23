# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử phần người lập theo dõi hồ sơ (ADR 0032): truy vấn gửi Flowable lọc theo tenant và người lập, mọi
# lý do không thấy hồ sơ cùng một câu 404, biến của bước không lộ ra, bước đang chờ của cả trang lấy từ một
# truy vấn. Dữ liệu giả theo đúng dạng Flowable 7.2 trả về (đã chạy thử trên image
# flowable/flowable-rest:7.2.0).

import httpx
import pytest
from fastapi.testclient import TestClient

from app import cases, flowable, history
from app.auth import caller_from_token
from app.flowable import Definition
from app.main import app
from app.names import node_names
from app.policy import Caller, Denied, visible_variables

USER_A = Caller(sub="u-a", username="user.a", tenant="xa-a", roles=frozenset({"user"}))
SERVICE = Caller(sub="svc", username="svc", tenant="xa-a", roles=frozenset(), service=True)
APPROVAL = Definition(
    decisions=frozenset({"approved"}),
    authorities=frozenset(),
    fields={"review": frozenset({"comment", "approved"})},
    nodes={
        "review": ("task", "Duyệt yêu cầu"),
        "approved": ("end", "Đã duyệt"),
        "rejected": ("end", "Từ chối"),
    },
)
INSTANCE = {
    "id": "p1",
    "processDefinitionId": "core-approval:1:d1",
    "processDefinitionKey": None,
    "tenantId": "xa-a",
    "startTime": "2026-11-23T09:10:52.102Z",
    "endTime": "2026-11-23T09:10:52.328Z",
    "endActivityId": "approved",
    "startUserId": "rest-admin",
    "variables": [
        {"name": "title", "value": "Duyệt", "scope": "local"},
        {"name": "comment", "value": "Đồng ý", "scope": "local"},
        {"name": "approved", "value": True, "scope": "local"},
        {"name": "initiator", "value": "u-a", "scope": "local"},
        {"name": "initiatorName", "value": "user.a", "scope": "local"},
        {"name": "authority_review", "value": "manager", "scope": "local"},
    ],
}


@pytest.fixture
def client():
    app.dependency_overrides[caller_from_token] = lambda: USER_A
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def sent(monkeypatch) -> list[tuple[str, dict]]:
    """Flowable giả: trả INSTANCE cho truy vấn hồ sơ, rỗng cho mọi truy vấn khác; ghi lại thân đã gửi."""
    calls: list[tuple[str, dict]] = []

    def call(_method, path, json=None, **_):
        calls.append((path, json))
        data = [INSTANCE] if path == "/query/historic-process-instances" else []
        return httpx.Response(200, json={"data": data, "total": len(data)})

    monkeypatch.setattr(flowable, "_call", call)
    monkeypatch.setattr(flowable, "definition_of", lambda _id: APPROVAL)
    monkeypatch.setattr(flowable, "process_key", lambda _id: "core-approval")
    return calls


def test_list_filters_by_tenant_and_initiator_at_flowable(client, sent):
    response = client.get("/v1/workflow/cases?process=core-approval&state=ended&offset=20&limit=10")
    assert response.status_code == 200
    path, body = sent[0]
    assert path == "/query/historic-process-instances"
    assert body["tenantId"] == "xa-a"
    assert body["variables"] == [
        {"name": "initiator", "value": "u-a", "operation": "equals", "type": "string"}
    ]
    assert (body["processDefinitionKeyIn"], body["finished"], body["start"], body["size"]) == (
        ["core-approval"],
        True,
        20,
        10,
    )
    # Hồ sơ đã kết thúc không có bước đang chờ: không hỏi thêm Flowable.
    assert len(sent) == 1


def test_list_hides_step_fields_and_core_variables(client, sent):
    item = client.get("/v1/workflow/cases").json()["items"][0]
    assert item["variables"] == {"title": "Duyệt"}
    assert (item["outcome"], item["outcomeName"], item["current"]) == ("approved", "Đã duyệt", [])
    assert "finished" not in sent[0][1] and "processDefinitionKeyIn" not in sent[0][1]


def test_detail_checks_instance_tenant_and_initiator_in_one_query(client, sent):
    response = client.get("/v1/workflow/cases/p1")
    assert response.status_code == 200
    assert sent[0][1] | {"includeProcessVariables": True} == {
        "processInstanceId": "p1",
        "tenantId": "xa-a",
        "variables": [{"name": "initiator", "value": "u-a", "operation": "equals", "type": "string"}],
        "includeProcessVariables": True,
    }
    assert response.json()["variables"] == {"title": "Duyệt"}


def test_every_unseen_case_is_the_same_404(client, monkeypatch):
    monkeypatch.setattr(history, "case", lambda *_: None)
    bodies = {client.get(f"/v1/workflow/cases/{case_id}").text for case_id in ("p1", "khong-co", "p2")}
    assert bodies == {'{"error":"Không tìm thấy hồ sơ."}'}
    assert client.get("/v1/workflow/cases/p1").status_code == 404


@pytest.mark.parametrize("path", ["/v1/workflow/cases", "/v1/workflow/cases/p1"])
def test_service_account_cannot_read_cases(path, sent):
    app.dependency_overrides[caller_from_token] = lambda: SERVICE
    try:
        assert TestClient(app).get(path).status_code == 403
    finally:
        app.dependency_overrides.clear()
    assert sent == []


@pytest.mark.parametrize(
    "query",
    [
        "state=done",
        "limit=0",
        "limit=101",
        "limit=x",
        "offset=-1",
        "process=",
        "process=a%20b",
        "process=../x",
    ],
)
def test_bad_query_is_400_and_names_the_parameter(client, sent, query):
    response = client.get(f"/v1/workflow/cases?{query}")
    assert response.status_code == 400
    assert response.json()["error"].startswith(f"Tham số không hợp lệ: {query.split('=')[0]}.")
    assert sent == []


def test_too_many_processes_is_400(client, sent):
    query = "&".join(f"process=p{i}" for i in range(21))
    assert client.get(f"/v1/workflow/cases?{query}").status_code == 400


def test_open_cases_take_current_steps_from_one_task_query(client, monkeypatch):
    raws = [INSTANCE | {"id": f"p{i}", "endTime": None, "endActivityId": None} for i in range(3)]
    monkeypatch.setattr(history, "cases", lambda *_: (3, raws))
    monkeypatch.setattr(flowable, "definition_of", lambda _id: APPROVAL)
    monkeypatch.setattr(flowable, "process_key", lambda _id: "core-approval")
    asked = []

    def open_tasks(tenant, initiator):
        asked.append((tenant, initiator))
        task = {"taskDefinitionKey": "review", "name": "Duyệt yêu cầu", "dueDate": "2026-11-26T09:02:36.996Z"}
        return [task | {"processInstanceId": "p0"}, task | {"processInstanceId": "p2"}]

    monkeypatch.setattr(history, "open_tasks", open_tasks)
    # Định nghĩa không có bước chờ: hồ sơ p1 không có task cũng không hỏi nhánh đang chạy.
    monkeypatch.setattr(history, "waiting", lambda *_: pytest.fail("không được hỏi nhánh"))
    items = client.get("/v1/workflow/cases?state=open").json()["items"]
    assert asked == [("xa-a", "u-a")]
    assert [len(item["current"]) for item in items] == [1, 0, 1]
    assert items[0]["current"] == [
        {"step": "review", "name": "Duyệt yêu cầu", "due": "2026-11-26T09:02:36.996Z"}
    ]


def test_open_case_without_task_asks_its_executions(client, monkeypatch):
    waiting_definition = Definition(
        frozenset(), frozenset(), {"a": frozenset({"comment"})}, {"a": ("task", "A"), "wait": ("wait", "Chờ")}
    )
    raws = [INSTANCE | {"id": "p1", "endTime": None, "endActivityId": None}]
    monkeypatch.setattr(history, "cases", lambda *_: (1, raws))
    monkeypatch.setattr(flowable, "definition_of", lambda _id: waiting_definition)
    monkeypatch.setattr(flowable, "process_key", lambda _id: "probe")
    monkeypatch.setattr(history, "open_tasks", lambda *_: [])
    asked = []

    def waiting(instances, tenant):
        asked.append((instances, tenant))
        return [{"processInstanceId": "p1", "activityId": "wait", "tenantId": "xa-a"}]

    monkeypatch.setattr(history, "waiting", waiting)
    items = client.get("/v1/workflow/cases?state=open").json()["items"]
    assert asked == [(["p1"], "xa-a")]
    assert items[0]["current"] == [{"step": "wait", "name": "Chờ", "due": None}]


def fake_rows(monkeypatch, rows: list[dict], total: int | None = None) -> list[dict]:
    """Flowable giả bỏ qua mọi khóa lọc: luôn trả `rows`."""
    sent: list[dict] = []

    def call(_method, _path, json=None, **_):
        sent.append(json)
        return httpx.Response(200, json={"data": rows, "total": len(rows) if total is None else total})

    monkeypatch.setattr(flowable, "_call", call)
    return sent


def test_rows_are_filtered_again_when_flowable_ignores_a_filter(monkeypatch):
    other = INSTANCE | {"variables": [{"name": "initiator", "value": "u-khac"}]}
    fake_rows(monkeypatch, [other, INSTANCE | {"id": "p2", "tenantId": "xa-b"}])
    assert history.case("p1", "xa-a", "u-a") is None
    assert history.cases("xa-a", "u-a", [], None, 0, 20)[1] == []
    fake_rows(monkeypatch, [{"processInstanceId": "khac"}, {"processInstanceId": "p1", "id": "t"}])
    assert history.task_history("p1") == [{"processInstanceId": "p1", "id": "t"}]
    waits = [
        {"processInstanceId": "p1", "activityType": "intermediateCatchEvent"},
        {"processInstanceId": "khac"},
    ]
    fake_rows(monkeypatch, waits)
    assert history.wait_history("p1") == waits[:1]


def test_waiting_asks_each_case_and_keeps_its_own_rows(monkeypatch):
    rows = [
        {"processInstanceId": "p1", "activityId": "wait", "tenantId": "xa-a"},
        {"processInstanceId": "p1", "activityId": "wait", "tenantId": "xa-b"},
        {"processInstanceId": "khac", "activityId": "wait", "tenantId": "xa-a"},
    ]
    sent = fake_rows(monkeypatch, rows)
    assert history.waiting(["p1"], "xa-a") == rows[:1]
    assert sent == [{"processInstanceId": "p1", "start": 0, "size": flowable.PAGE_SIZE}]


def test_waiting_refuses_a_case_with_more_executions_than_one_page(monkeypatch):
    fake_rows(monkeypatch, [{"processInstanceId": "p1", "tenantId": "xa-a"}], total=500)
    with pytest.raises(Denied) as error:
        history.waiting(["p1"], "xa-a")
    assert error.value.status == 502 and "500" in error.value.reason


def test_detail_reads_groups_of_the_latest_steps_only(client, monkeypatch):
    monkeypatch.setattr(history, "case", lambda *_: INSTANCE)
    monkeypatch.setattr(flowable, "definition_of", lambda _id: APPROVAL)
    monkeypatch.setattr(flowable, "process_key", lambda _id: "core-approval")
    tasks = [
        {
            "id": f"t{i:03}",
            "taskDefinitionKey": "review",
            "startTime": f"2026-11-23T09:{i // 60:02}:{i % 60:02}Z",
        }
        for i in range(60)
    ]
    monkeypatch.setattr(history, "task_history", lambda _id: tasks)
    monkeypatch.setattr(history, "wait_history", lambda _id: [])
    read = []
    monkeypatch.setattr(history, "groups_of", lambda task: read.append(task["id"]) or frozenset({"manager"}))
    steps = client.get("/v1/workflow/cases/p1").json()["steps"]
    assert read == [f"t{i:03}" for i in range(10, 60)]
    assert steps[0]["groups"] == [] and steps[-1]["groups"] == ["manager"]


def test_wait_open_when_the_case_was_deleted_is_cancelled():
    task = {
        "id": "t1",
        "taskDefinitionKey": "a",
        "startTime": "2026-11-23T09:00:00.000Z",
        "endTime": "2026-11-23T09:00:01.000Z",
    }
    wait = {
        "activityId": "wait",
        "startTime": "2026-11-23T09:00:01.000Z",
        "endTime": "2026-11-23T09:05:00.000Z",
    }
    assert [s["status"] for s in cases.timeline([task], [wait], {}, deleted=True)] == ["done", "cancelled"]
    assert [s["status"] for s in cases.timeline([task], [wait], {})] == ["done", "done"]
    # Bước chờ đã qua, rồi hồ sơ bị xóa ở bước sau: bước chờ vẫn là đã xong.
    later = task | {
        "id": "t2",
        "startTime": "2026-11-23T09:05:00.000Z",
        "endTime": "2026-11-23T09:06:00.000Z",
    }
    statuses = [s["status"] for s in cases.timeline([task, later], [wait], {}, deleted=True)]
    assert statuses == ["done", "done", "done"]


def test_current_of_keeps_only_listed_cases_and_wait_nodes():
    nodes = {"p1": {"wait": ("wait", "Công khai"), "submit": ("task", "Trình")}}
    tasks = [{"processInstanceId": "khac", "taskDefinitionKey": "submit", "name": "Trình"}]
    executions = [
        {"processInstanceId": "p1", "activityId": None},
        {"processInstanceId": "p1", "activityId": "wait"},
        {"processInstanceId": "khac", "activityId": "wait"},
    ]
    assert cases.current_of(tasks, executions, nodes) == {
        "p1": [{"step": "wait", "name": "Công khai", "due": None}]
    }


def test_timeline_status_groups_and_no_handler_identity():
    tasks = [
        {
            "id": "t1",
            "taskDefinitionKey": "decide",
            "name": "Quyết định",
            "startTime": "2026-11-23T09:11:13.286Z",
            "endTime": None,
            "dueDate": None,
            "deleteReason": None,
            "assignee": "sub-cua-nguoi-duyet",
        },
        {
            "id": "t0",
            "taskDefinitionKey": "review",
            "name": "Duyệt",
            "startTime": "2026-11-23T09:11:13.100Z",
            "endTime": "2026-11-23T09:11:22.065Z",
            "dueDate": None,
            "deleteReason": "boundary event (late)",
            "assignee": None,
        },
    ]
    waits = [
        {
            "activityId": "publication",
            "activityName": "Công khai",
            "startTime": "2026-11-23T09:11:13.200Z",
            "endTime": "2026-11-23T09:11:13.250Z",
        }
    ]
    steps = cases.timeline(
        tasks, waits, {"t1": frozenset({"tinh-mau/manager"}), "t0": frozenset({"manager"})}
    )
    assert [(s["step"], s["kind"], s["status"]) for s in steps] == [
        ("review", "task", "cancelled"),
        ("publication", "wait", "done"),
        ("decide", "task", "open"),
    ]
    assert steps[2]["groups"] == ["tinh-mau/manager"] and steps[2]["claimed"] is True
    assert "sub-cua-nguoi-duyet" not in str(steps)


def test_historic_groups_read_group_id(monkeypatch):
    links = [
        {"type": "candidate", "groupId": "manager", "userId": None},
        {"type": "assignee", "userId": "m-a"},
    ]
    monkeypatch.setattr(flowable, "_call", lambda *_a, **_k: httpx.Response(200, json=links))
    assert history.groups_of({"id": "t1", "endTime": "2026-11-23T09:02:59.704Z"}) == frozenset({"manager"})


def test_visible_variables_drops_every_step_field():
    variables = {
        "title": "x",
        "comment": "c",
        "decision": "d",
        "tenant": "xa-a",
        "authority_decide": "manager",
    }
    fields = {"review": frozenset({"comment"}), "decide": frozenset({"decision"})}
    assert visible_variables(variables, fields, has_steps=True) == {"title": "x"}


def test_visible_variables_fail_closed_without_declared_fields():
    assert visible_variables({"title": "x", "note": "n"}, {}, has_steps=True) == {}
    assert visible_variables({"title": "x"}, {}, has_steps=False) == {"title": "x"}


BPMN = b"""<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <process id="p">
    <userTask id="review" name="Duyet"/>
    <subProcess id="sub"><userTask id="inner"/></subProcess>
    <intermediateCatchEvent id="wait" name="Cho"/>
    <exclusiveGateway id="g" name="Cong"/>
    <endEvent id="ok" name="Xong"/>
  </process>
  <process id="other"><endEvent id="x" name="Khac"/></process>
</definitions>"""


def test_node_names_reads_tasks_waits_and_ends_of_the_process():
    assert node_names(BPMN, "p") == {
        "review": ("task", "Duyet"),
        "inner": ("task", "inner"),
        "wait": ("wait", "Cho"),
        "ok": ("end", "Xong"),
    }


@pytest.mark.parametrize("bpmn,key", [(b"<definitions", "p"), (BPMN, "khong-co")])
def test_node_names_refuses_unreadable_bpmn(bpmn, key):
    with pytest.raises(ValueError):
        node_names(bpmn, key)
