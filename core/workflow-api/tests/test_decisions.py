# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử cách tìm biến quyết định từ BPMN (ADR 0025): điều kiện sau một userTask là quyết định của người
# xử lý bước, điều kiện trước mọi userTask là dữ liệu người lập được gửi. BPMN viết ngay trong test, trừ
# quy trình mẫu của lõi.

from pathlib import Path

import pytest

from app.decisions import decision_variables

FIXTURE = Path(__file__).parents[2] / "workflow" / "fixtures" / "core-approval.bpmn20.xml"


def bpmn(body: str, key: str = "p") -> bytes:
    return (
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" '
        'xmlns:flowable="http://flowable.org/bpmn">'
        f'<process id="{key}">{body}</process></definitions>'
    ).encode()


def flow(name: str, source: str, target: str, condition: str = "") -> str:
    expression = f"<conditionExpression>{condition}</conditionExpression>" if condition else ""
    return f'<sequenceFlow id="{name}" sourceRef="{source}" targetRef="{target}">{expression}</sequenceFlow>'


def test_core_approval_decision_is_approved():
    assert "approved" in decision_variables(FIXTURE.read_bytes(), "core-approval")


@pytest.mark.parametrize(
    "condition",
    ["${approved}", "${approved == true}", '${execution.getVariable("approved") == true}', "${!approved}"],
)
def test_every_way_of_reading_a_variable_counts(condition):
    body = (
        '<userTask id="t"/><exclusiveGateway id="g"/>'
        + flow("a", "t", "g")
        + flow("b", "g", "end", condition)
    )
    assert "approved" in decision_variables(bpmn(body), "p")


def test_condition_before_the_first_task_is_input_not_decision():
    # Hình của quy trình rà soát diện tích: rẽ nhánh theo dữ liệu người lập rồi mới tới bước duyệt.
    body = (
        '<startEvent id="s"/><exclusiveGateway id="route"/><userTask id="t"/><exclusiveGateway id="g"/>'
        + flow("a", "s", "route")
        + flow("b", "route", "t", "${excessM2 &lt;= 300}")
        + flow("c", "t", "g")
        + flow("d", "g", "end", "${approved == true}")
    )
    found = decision_variables(bpmn(body), "p")
    assert "approved" in found
    assert "excessM2" not in found


def test_condition_after_a_later_node_still_counts():
    # Bước duyệt rồi một sự kiện chờ rồi mới rẽ nhánh: người duyệt vẫn là người quyết định.
    body = (
        '<userTask id="t"/><intermediateCatchEvent id="wait"/><exclusiveGateway id="g"/>'
        + flow("a", "t", "wait")
        + flow("b", "wait", "g")
        + flow("c", "g", "end", "${ok}")
    )
    assert "ok" in decision_variables(bpmn(body), "p")


def test_conditional_flow_leaving_the_task_counts():
    body = '<userTask id="t"/>' + flow("a", "t", "end", "${approved}")
    assert "approved" in decision_variables(bpmn(body), "p")


def test_branch_after_boundary_event_of_a_task_counts():
    body = (
        '<userTask id="t"/><boundaryEvent id="late" attachedToRef="t"/><exclusiveGateway id="g"/>'
        + flow("a", "late", "g")
        + flow("b", "g", "end", "${escalate}")
    )
    assert "escalate" in decision_variables(bpmn(body), "p")


def test_branch_after_subprocess_with_a_task_counts():
    body = (
        '<subProcess id="sub"><startEvent id="ss"/><userTask id="t"/>'
        + flow("a", "ss", "t")
        + '</subProcess><exclusiveGateway id="g"/>'
        + flow("b", "sub", "g")
        + flow("c", "g", "end", "${approved}")
    )
    assert "approved" in decision_variables(bpmn(body), "p")


def test_branch_inside_subprocess_after_a_task_counts():
    # Duyệt rồi vào một subProcess có cổng đọc approved ngay đầu.
    body = (
        '<userTask id="t"/><subProcess id="sub"><startEvent id="ss"/><exclusiveGateway id="g"/>'
        + flow("b", "ss", "g")
        + flow("c", "g", "end", "${approved}")
        + "</subProcess>"
        + flow("a", "t", "sub")
    )
    assert "approved" in decision_variables(bpmn(body), "p")


def test_branch_before_the_task_inside_a_subprocess_is_input():
    # Ra khỏi subProcess không chạy lại từ đầu nó, nên cổng đứng trước bước bên trong vẫn là dữ liệu người
    # lập.
    body = (
        '<startEvent id="s"/><subProcess id="sub"><startEvent id="ss"/><exclusiveGateway id="route"/>'
        '<userTask id="t"/>'
        + flow("b", "ss", "route")
        + flow("c", "route", "t", "${excessM2 &gt; 300}")
        + "</subProcess>"
        + flow("a", "s", "sub")
        + flow("d", "sub", "end", "${approved}")
    )
    found = decision_variables(bpmn(body), "p")
    assert "approved" in found
    assert "excessM2" not in found


def test_process_without_tasks_has_no_decisions():
    body = '<startEvent id="s"/>' + flow("a", "s", "end", "${approved}")
    assert decision_variables(bpmn(body), "p") == frozenset()


def test_only_the_requested_process_is_read():
    other = '<process id="other"><userTask id="t"/>' + flow("a", "t", "end", "${approved}") + "</process>"
    content = bpmn('<userTask id="t2"/>').replace(b"</definitions>", other.encode() + b"</definitions>")
    assert decision_variables(content, "p") == frozenset()
    assert "approved" in decision_variables(content, "other")


@pytest.mark.parametrize(
    ("content", "key"), [(b"<definitions", "p"), (bpmn("<userTask id='t'/>"), "missing")]
)
def test_unreadable_bpmn_is_an_error(content, key):
    with pytest.raises(ValueError):
        decision_variables(content, key)
