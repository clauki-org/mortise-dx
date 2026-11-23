# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử route đếm hồ sơ (ADR 0035): mỗi số là `total` của một truy vấn lọc theo tenant trong token, khóa
# quy trình và bước; quá hạn lọc bằng dueBefore cùng một thời điểm; chỉ người có vai trò của một bước (viết
# trong BPMN hay trong bảng phân cấp) được xem, người khác nhận đúng câu 404 như quy trình không có; tài khoản
# dịch vụ 403; dòng mẫu sai tenant thì 502. Khóa lọc dùng ở đây đã chạy thử trên flowable/flowable-rest:7.2.0:
# mỗi khóa đổi `total` đúng như dữ liệu đã tạo.

import httpx
import pytest
from fastapi.testclient import TestClient

from app import counts, db, flowable
from app.auth import caller_from_token
from app.authority import static_groups
from app.flowable import Definition
from app.main import app
from app.policy import Caller

MANAGER = Caller(sub="m-a", username="manager.a", tenant="xa-a", roles=frozenset({"manager", "user"}))
USER = Caller(sub="u-a", username="user.a", tenant="xa-a", roles=frozenset({"user"}))
CLERK = Caller(sub="c-a", username="clerk.a", tenant="xa-a", roles=frozenset({"clerk"}))
SERVICE = Caller(sub="svc", username="svc", tenant="xa-a", roles=frozenset(), service=True)
REVIEW = Definition(
    decisions=frozenset(),
    authorities=frozenset({"decide"}),
    nodes={
        "review": ("task", "Duyệt"),
        "wait": ("wait", "Công khai"),
        "decide": ("task", "Quyết định"),
        "done": ("end", "Xong"),
    },
    groups=frozenset({"manager"}),
)
# total của từng truy vấn theo (đường dẫn, bước, có dueBefore, finished).
TOTALS = {
    ("/query/process-instances", None, False, None): 5,
    ("/query/historic-process-instances", None, False, True): 7,
    ("/query/tasks", None, True, None): 2,
    ("/query/tasks", "review", False, None): 3,
    ("/query/tasks", "review", True, None): 2,
    ("/query/tasks", "decide", False, None): 1,
    ("/query/tasks", "decide", True, None): 0,
}


def as_caller(caller: Caller) -> TestClient:
    app.dependency_overrides[caller_from_token] = lambda: caller
    return TestClient(app)


@pytest.fixture(autouse=True)
def clear():
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def sent(monkeypatch) -> list[tuple[str, dict]]:
    """Flowable giả: trả total theo TOTALS và một dòng mẫu đúng điều kiện; ghi lại thân đã gửi."""
    calls: list[tuple[str, dict]] = []

    def call(_method, path, json=None, **_):
        calls.append((path, json))
        step = json.get("taskDefinitionKey")
        total = TOTALS[(path, step, "dueBefore" in json, json.get("finished"))]
        row = {"tenantId": json["tenantId"], "processDefinitionId": "d1"}
        row["taskDefinitionKey"] = step or "review"
        return httpx.Response(200, json={"data": [row] if total else [], "total": total})

    monkeypatch.setattr(flowable, "_call", call)
    monkeypatch.setattr(flowable, "definition", lambda key, tenant: REVIEW)
    monkeypatch.setattr(flowable, "process_key", lambda _id: "review-process")
    monkeypatch.setattr(db, "authority_roles", lambda tenant, process: frozenset({"clerk"}))
    return calls


def test_counts_are_flowable_totals_per_step(sent):
    body = as_caller(MANAGER).get("/v1/workflow/processes/review-process/counts").json()
    assert {k: body[k] for k in ("process", "open", "finished", "overdue")} == {
        "process": "review-process",
        "open": 5,
        "finished": 7,
        "overdue": 2,
    }
    # Chỉ bước người làm, theo thứ tự trong BPMN; bước chờ không có task nên không thành dòng.
    assert body["steps"] == [
        {"step": "review", "name": "Duyệt", "open": 3, "overdue": 2},
        {"step": "decide", "name": "Quyết định", "open": 1, "overdue": 0},
    ]


def test_every_query_filters_by_token_tenant_and_process(sent):
    body = as_caller(MANAGER).get("/v1/workflow/processes/review-process/counts").json()
    assert len(sent) == 3 + 2 * 2
    for _path, query in sent:
        assert query["tenantId"] == "xa-a"
        assert query["processDefinitionKey"] == "review-process"
        assert (query["start"], query["size"]) == (0, 1)
    # Mọi truy vấn quá hạn so với cùng một thời điểm, là thời điểm trả về.
    assert {query["dueBefore"] for _, query in sent if "dueBefore" in query} == {body["counted_at"]}
    assert ("/query/historic-process-instances", True) in [(p, q.get("finished")) for p, q in sent]


def test_role_from_authority_table_may_count(sent):
    assert as_caller(CLERK).get("/v1/workflow/processes/review-process/counts").status_code == 200


def test_static_role_does_not_read_the_database(sent, monkeypatch):
    def fail(*_):
        raise AssertionError("không được đọc CSDL khi vai trò trong BPMN đã khớp")

    monkeypatch.setattr(db, "authority_roles", fail)
    assert as_caller(MANAGER).get("/v1/workflow/processes/review-process/counts").status_code == 200


def test_role_outside_the_process_gets_the_missing_process_404(sent, monkeypatch):
    response = as_caller(USER).get("/v1/workflow/processes/review-process/counts")
    assert response.status_code == 404
    assert response.json() == {"error": "Tenant chưa có quy trình 'review-process'."}
    assert sent == []
    # Quy trình không có bước đọc bảng phân cấp: không hỏi CSDL, vẫn 404.
    monkeypatch.setattr(flowable, "definition", lambda key, tenant: Definition(frozenset(), frozenset()))
    assert as_caller(CLERK).get("/v1/workflow/processes/review-process/counts").status_code == 404


def test_service_account_cannot_count(sent):
    assert as_caller(SERVICE).get("/v1/workflow/processes/review-process/counts").status_code == 403


def test_sample_row_from_another_tenant_is_refused(sent, monkeypatch):
    real = flowable._call

    def leaky(method, path, json=None, **kwargs):
        response = real(method, path, json=json, **kwargs)
        page = response.json()
        for row in page["data"]:
            row["tenantId"] = "xa-b"
        return httpx.Response(200, json=page)

    monkeypatch.setattr(flowable, "_call", leaky)
    assert as_caller(MANAGER).get("/v1/workflow/processes/review-process/counts").status_code == 502


def test_counter_checks_step_of_sample_row(monkeypatch):
    monkeypatch.setattr(flowable, "process_key", lambda _id: "p")
    counter = counts._Counter("p", "xa-a", "2026-11-23T00:00:00Z")
    row = {"tenantId": "xa-a", "processDefinitionId": "d1", "taskDefinitionKey": "other"}
    assert not counter._matches(row, "review")
    assert counter._matches(row, None)


def test_static_groups_skip_expressions():
    bpmn = b"""<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
      xmlns:flowable="http://flowable.org/bpmn"><process id="p">
      <userTask id="a" flowable:candidateGroups="manager, clerk"/>
      <userTask id="b" flowable:candidateGroups="${authority_b}"/>
      <subProcess id="s"><userTask id="c" flowable:candidateGroups="auditor,#{other}"/></subProcess>
    </process></definitions>"""
    assert static_groups(bpmn, "p") == {"manager", "clerk", "auditor"}
