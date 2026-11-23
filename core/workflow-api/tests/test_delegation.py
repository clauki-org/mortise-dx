# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử bước thuộc thẩm quyền của tenant cha trong hồ sơ tenant con (ADR 0029): quy tắc hoàn thành (hàm
# thuần), bảng việc của người tenant cha, và các route với Flowable và CSDL giả. Tenant demo: tinh-mau là cha
# của xa-a, xa-b; tinh-khac không có con; thon-1 là con của xa-a (cháu của tinh-mau).

from dataclasses import replace

import pg8000.native
import pytest
from fastapi.testclient import TestClient
from pg8000.exceptions import InterfaceError

from app import db, delegation, flowable
from app.auth import caller_from_token
from app.authority import PARENT, Row
from app.main import app
from app.policy import (
    FOUR_EYES,
    Caller,
    Denied,
    TaskView,
    check_parent_can_complete,
    delegated_to,
    parent_groups,
)

MANAGER_TINH = Caller(
    sub="m-tinh",
    username="manager.tinh",
    tenant="tinh-mau",
    roles=frozenset({"user", "manager"}),
    methods=frozenset({"pwd", "otp"}),
)
MANAGER_K = replace(MANAGER_TINH, sub="m-k", username="manager.k", tenant="tinh-khac")
MANAGER_A = replace(MANAGER_TINH, sub="m-a", username="manager.a", tenant="xa-a")
MANAGER_B = replace(MANAGER_TINH, sub="m-b", username="manager.b", tenant="xa-b")
CHILDREN = {"tinh-mau": frozenset({"xa-a", "xa-b"}), "xa-a": frozenset({"thon-1"})}


def decide_task(**changes) -> TaskView:
    base = dict(
        tenant="xa-a",
        assignee=None,
        candidate_groups=frozenset({"tinh-mau/manager"}),
        category=FOUR_EYES,
        initiator="u-a",
        authority=True,
    )
    return TaskView(**(base | changes))


def check(caller: Caller, task: TaskView) -> None:
    check_parent_can_complete(caller, task, CHILDREN.get(caller.tenant, frozenset()))


def status_of(caller: Caller, task: TaskView) -> int:
    with pytest.raises(Denied) as error:
        check(caller, task)
    return error.value.status


def test_parent_tenant_completes_the_step_delegated_to_it():
    check(MANAGER_TINH, decide_task())


def test_groups_are_built_from_the_caller_tenant_and_roles():
    assert parent_groups(MANAGER_TINH) == ["tinh-mau/manager", "tinh-mau/user"]


@pytest.mark.parametrize(
    ("caller", "task"),
    [
        # Xã cùng tỉnh: nhóm của task là nhóm của tỉnh, không phải của xã B.
        (MANAGER_B, decide_task()),
        # Tỉnh khác: cùng vai trò manager nhưng nhóm mang tên tỉnh khác.
        (MANAGER_K, decide_task()),
        # Chính xã A: task được gán cho tỉnh thì người trong xã cũng không làm được.
        (MANAGER_A, decide_task()),
    ],
)
def test_tenants_other_than_the_named_parent_are_not_delegated_to(caller, task):
    assert not delegated_to(caller, task)
    assert status_of(caller, task) == 404


def test_tenant_that_is_no_longer_the_parent_sees_not_found():
    # Nhóm vẫn mang tên tinh-mau, nhưng xa-c không (còn) là con của tinh-mau.
    assert status_of(MANAGER_TINH, decide_task(tenant="xa-c")) == 404


def test_grandchild_is_not_covered():
    # thon-1 là con của xa-a; tinh-mau không phải cha trực tiếp.
    assert status_of(MANAGER_TINH, decide_task(tenant="thon-1")) == 404


def test_step_not_read_from_the_authority_table_is_not_delegated():
    assert status_of(MANAGER_TINH, decide_task(authority=False)) == 404


def test_role_the_caller_does_not_hold_is_not_found():
    task = decide_task(candidate_groups=frozenset({"tinh-mau/tenant_admin"}))
    assert status_of(MANAGER_TINH, task) == 404


def test_parent_path_needs_a_second_factor():
    caller = replace(MANAGER_TINH, methods=frozenset({"pwd"}))
    assert status_of(caller, decide_task()) == 403


def test_second_factor_check_comes_after_scope_so_strangers_still_get_404():
    caller = replace(MANAGER_K, methods=frozenset({"pwd"}))
    assert status_of(caller, decide_task()) == 404


def test_task_claimed_by_someone_else_is_denied():
    assert status_of(MANAGER_TINH, decide_task(assignee="other")) == 403


def test_task_claimed_by_the_caller_can_be_completed():
    check(MANAGER_TINH, decide_task(assignee="m-tinh"))


def test_four_eyes_still_applies():
    assert status_of(MANAGER_TINH, decide_task(initiator="m-tinh")) == 403


def raw_task(task_id: str, tenant: str, assignee: str | None = None) -> dict:
    return {
        "id": task_id,
        "name": "Quyết định",
        "tenantId": tenant,
        "taskDefinitionKey": "decide",
        "processDefinitionId": "core-authority:1:x",
        "processInstanceId": f"p-{task_id}",
        "createTime": "2026-11-23T00:00:00Z",
        "assignee": assignee,
        "category": FOUR_EYES,
        "variables": [
            {"name": "authority_decide", "value": "tinh-mau/manager"},
            {"name": "initiator", "value": "u-a"},
        ],
    }


@pytest.fixture
def stack(monkeypatch) -> dict:
    """Flowable và CSDL giả.

    `own` là task tenant của người gọi thấy, `foreign` là task truy vấn không lọc tenant trả về, `reads` ghi
    các lần đọc tenant con.
    """
    state: dict = {
        "caller": MANAGER_TINH,
        "own": [],
        "foreign": [raw_task("t1", "xa-a")],
        "reads": [],
        "queries": [],
        "completed": [],
        "groups": frozenset({"tinh-mau/manager"}),
    }

    # Như Flowable: theo nhóm thì chỉ task chưa ai nhận, theo người nhận thì đúng người đó; tenant None là mọi
    # tenant.
    def tasks(tenant, *, groups=None, assignee=None):
        state["queries"].append((tenant, groups, assignee))
        pool = state["foreign"] + state["own"] if tenant is None else state["own"]
        if groups is not None:
            return [t for t in pool if t["assignee"] is None]
        return [t for t in pool if t["assignee"] == assignee]

    def children(tenant):
        state["reads"].append(tenant)
        return CHILDREN.get(tenant, frozenset())

    def task(task_id):
        return next((t for t in state["foreign"] + state["own"] if t["id"] == task_id), None)

    monkeypatch.setattr(flowable, "tasks", tasks)
    monkeypatch.setattr(flowable, "task", task)
    monkeypatch.setattr(flowable, "candidate_groups", lambda _id: state["groups"])
    monkeypatch.setattr(flowable, "process_key", lambda _id: "core-authority")
    # Hoàn thành đọc trường của bước từ phiên bản quy trình đang chạy (ADR 0031); bước này không có trường.
    monkeypatch.setattr(
        flowable, "definition_of", lambda _id: flowable.Definition(frozenset(), frozenset({"decide"}))
    )
    monkeypatch.setattr(
        flowable, "claim_and_complete", lambda task_id, sub, _v: state["completed"].append((task_id, sub))
    )
    monkeypatch.setattr(db, "children", children)
    monkeypatch.setitem(app.dependency_overrides, caller_from_token, lambda: state["caller"])
    return state


client = TestClient(app)
real_children = db.children
TASKS = "/v1/workflow/tasks"


def test_listing_shows_delegated_tasks_of_children_with_their_tenant(stack):
    response = client.get(TASKS)
    assert response.status_code == 200
    assert [(t["id"], t["tenant"]) for t in response.json()] == [("t1", "xa-a")]
    # Hai truy vấn không lọc tenant: theo nhóm (chỉ task chưa ai nhận) và theo người nhận là chính caller, để
    # task đã giao cho người khác không chiếm chỗ trong các trang.
    assert (None, ["tinh-mau/manager", "tinh-mau/user"], None) in stack["queries"]
    assert (None, None, "m-tinh") in stack["queries"]


def test_listing_drops_tasks_of_tenants_that_are_not_current_children(stack):
    stack["foreign"] = [raw_task("t1", "xa-a"), raw_task("t2", "xa-c"), raw_task("t3", "thon-1")]
    assert [t["id"] for t in client.get(TASKS).json()] == ["t1"]


def test_listing_drops_tasks_claimed_by_someone_else_and_keeps_own_claims(stack):
    stack["foreign"] = [raw_task("t1", "xa-a", "other"), raw_task("t2", "xa-a", "m-tinh")]
    assert [t["id"] for t in client.get(TASKS).json()] == ["t2"]


def test_listing_drops_own_claims_whose_group_is_not_the_caller_group(stack):
    stack["foreign"] = [raw_task("t2", "xa-a", "m-tinh")]
    stack["groups"] = frozenset({"manager"})
    assert client.get(TASKS).json() == []


def test_listing_drops_steps_that_do_not_read_the_authority_table(stack):
    literal = raw_task("t2", "xa-a")
    literal["variables"] = [{"name": "initiator", "value": "u-a"}]
    stack["foreign"] = [raw_task("t1", "xa-a"), literal]
    assert [t["id"] for t in client.get(TASKS).json()] == ["t1"]


def test_listing_reads_the_database_only_when_a_foreign_task_was_found(stack):
    stack["foreign"] = []
    assert client.get(TASKS).json() == []
    assert stack["reads"] == []


def test_listing_keeps_own_tenant_tasks_with_own_tenant(stack):
    stack["caller"] = MANAGER_A
    stack["own"] = [raw_task("t9", "xa-a")]
    # Truy vấn không lọc tenant trả cả task của chính tenant; không được thành việc của tenant cha.
    stack["foreign"] = []
    assert [(t["id"], t["tenant"]) for t in client.get(TASKS).json()] == [("t9", "xa-a")]
    assert stack["reads"] == []


def test_listing_of_a_caller_without_roles_does_not_query_across_tenants():
    assert delegation.tasks(replace(MANAGER_TINH, roles=frozenset())) == []


def test_parent_completes_through_the_route(stack):
    assert client.post(f"{TASKS}/t1/complete", json={"variables": {}}).status_code == 204
    assert stack["completed"] == [("t1", "m-tinh")]
    assert stack["reads"] == ["tinh-mau"]


@pytest.mark.parametrize(("caller", "status"), [(MANAGER_B, 404), (MANAGER_K, 404), (MANAGER_A, 403)])
def test_route_refuses_everyone_else_without_reading_the_database(stack, caller, status):
    # manager.a ở chính xã của hồ sơ nên nhận 403 của luật vai trò như mọi task trong tenant mình.
    stack["caller"] = caller
    response = client.post(f"{TASKS}/t1/complete", json={"variables": {}})
    assert response.status_code == status
    assert stack["completed"] == []
    assert stack["reads"] == []


def test_route_refuses_the_parent_after_the_child_moved_to_another_parent(stack):
    stack["foreign"] = [raw_task("t1", "xa-c")]
    assert client.post(f"{TASKS}/t1/complete", json={"variables": {}}).status_code == 404
    assert stack["completed"] == []


def test_parent_cannot_read_the_child_case(stack, monkeypatch):
    monkeypatch.setattr(flowable, "instance", lambda _id: {"id": "p-t1", "tenantId": "xa-a", "endTime": None})
    assert client.get("/v1/workflow/instances/p-t1").status_code == 404


def test_start_in_a_child_tenant_names_the_parent_group(monkeypatch):
    sent = []
    rows = {"decide": [Row("default", None, None, "manager"), Row("up", "amount", 1000.0, "manager", PARENT)]}
    monkeypatch.setattr(db, "authorities", lambda *_: ("tinh-mau", rows))
    monkeypatch.setattr(
        flowable, "definition", lambda *_: flowable.Definition(frozenset(), frozenset({"decide"}))
    )
    monkeypatch.setattr(flowable, "start", lambda _k, _t, variables: sent.append(variables) or {"id": "p1"})
    monkeypatch.setitem(app.dependency_overrides, caller_from_token, lambda: MANAGER_A)
    client.post("/v1/workflow/processes/core-authority/instances", json={"variables": {"amount": 5000}})
    client.post("/v1/workflow/processes/core-authority/instances", json={"variables": {"amount": 10}})
    assert [v["authority_decide"] for v in sent] == ["tinh-mau/manager", "manager"]


def test_listing_is_503_when_the_database_cannot_be_read(stack, monkeypatch):
    def refuse(*_args, **_kwargs):
        raise InterfaceError("connection refused")

    # db.children thật, chỉ kết nối hỏng: người có task từ tenant con nhận 503 kèm cách khắc phục, không nhận
    # bảng việc thiếu task.
    monkeypatch.setattr(db, "children", real_children)
    monkeypatch.setattr(pg8000.native, "Connection", refuse)
    response = client.get(TASKS)
    assert response.status_code == 503
    assert "make ps" in response.json()["error"]


def test_tenant_with_a_slash_cannot_borrow_the_group_of_another_tenant():
    # Tenant "a" có vai trò "b/c" (Keycloak không cấm "/" trong tên vai trò) ghép ra nhóm "a/b/c", trùng nhóm
    # mà dòng parent đặt cho tenant con của tenant "a/b" có vai trò "c". Nhóm khớp, nhưng task không thuộc
    # tenant con của "a", nên vẫn 404.
    caller = replace(MANAGER_TINH, tenant="a", roles=frozenset({"b/c"}))
    task = decide_task(tenant="x", candidate_groups=frozenset({"a/b/c"}))
    assert delegated_to(caller, task)
    with pytest.raises(Denied) as error:
        check_parent_can_complete(caller, task, frozenset({"y"}))
    assert error.value.status == 404
    check_parent_can_complete(caller, task, frozenset({"x"}))
