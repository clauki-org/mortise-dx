# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử cách workflow-api lấy biến quyết định từ Flowable (ADR 0025): hỏi phiên bản mới nhất của quy
# trình trong tenant, đọc BPMN một lần cho mỗi phiên bản, từ chối khi không đọc được. REST của Flowable được
# thay bằng bản giả ở tầng gọi HTTP.

import httpx
import pytest

from app import flowable
from app.policy import Denied

BPMN = (
    b'<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"><process id="p">'
    b'<userTask id="t"/><sequenceFlow id="a" sourceRef="t" targetRef="end">'
    b"<conditionExpression>${approved}</conditionExpression></sequenceFlow></process></definitions>"
)


@pytest.fixture
def rest(monkeypatch) -> dict:
    """Phiên bản mới nhất mỗi lần hỏi, nội dung BPMN, và danh sách đường đã gọi."""
    state: dict = {"definitions": ["p:1:a"], "bpmn": BPMN, "calls": []}

    def call(method, path, **kwargs):
        state["calls"].append(path)
        if path == "/repository/process-definitions":
            assert kwargs["params"] == {"key": "p", "tenantId": "xa-a", "latest": "true"}
            current = state["definitions"][:1]
            return httpx.Response(200, json={"data": [{"id": i} for i in current]})
        return httpx.Response(200, content=state["bpmn"])

    monkeypatch.setattr(flowable, "_call", call)
    monkeypatch.setattr(flowable, "_decisions", {})
    return state


def test_decisions_come_from_the_latest_definition(rest):
    assert "approved" in flowable.decisions("p", "xa-a")
    assert rest["calls"][-1] == "/repository/process-definitions/p:1:a/resourcedata"


def test_bpmn_is_read_once_per_definition(rest):
    flowable.decisions("p", "xa-a")
    flowable.decisions("p", "xa-a")
    assert sum(path.endswith("/resourcedata") for path in rest["calls"]) == 1
    # Deploy phiên bản mới: cùng khóa, mã định nghĩa khác, nên BPMN được đọc lại.
    rest["definitions"] = ["p:2:b"]
    rest["bpmn"] = BPMN.replace(b"${approved}", b"${accepted}")
    assert "accepted" in flowable.decisions("p", "xa-a")


def test_missing_process_is_404(rest):
    rest["definitions"] = []
    with pytest.raises(Denied) as error:
        flowable.decisions("p", "xa-a")
    assert error.value.status == 404


def test_unreadable_bpmn_refuses_the_start(rest):
    rest["bpmn"] = b"<definitions"
    with pytest.raises(Denied) as error:
        flowable.decisions("p", "xa-a")
    assert error.value.status == 502
