# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Số hồ sơ của một quy trình trong tenant của người gọi (ADR 0035): còn mở, đã kết thúc, bước quá hạn, và số
# đang chờ theo từng bước. Chỉ trả số, không trả biến, mã hồ sơ hay tên người. main.py gắn router này vào ứng
# dụng; thành phần bảng điều hành (Tầng 2) đọc route này cho nguồn `workflow`.
#
# Mỗi số là `total` của một truy vấn Flowable. Flowable bỏ qua im lặng khóa lọc nó không biết (history.py), mà
# một tổng thì không lọc lại được như dòng; nên chỉ dùng khóa đã thử thấy lọc thật trên flowable-rest 7.2.0,
# và mỗi truy vấn xin một dòng mẫu để kiểm dòng đó đúng tenant, quy trình, bước: khóa bị bỏ qua ở phiên bản
# sau thì trả 502 thay vì trả số của tenant khác.

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends

from . import db, flowable
from .auth import caller_from_token
from .policy import Caller, Denied, check_person
from .schemas import ProcessCounts, error_responses

router = APIRouter()

CallerDep = Annotated[Caller, Depends(caller_from_token)]


@router.get(
    "/v1/workflow/processes/{key}/counts",
    response_model=ProcessCounts,
    responses=error_responses(403, 404, 502, 503),
)
def process_counts(key: str, caller: CallerDep) -> dict:
    """Số hồ sơ của quy trình `key` trong tenant của người gọi; chỉ người có vai trò của một bước được xem."""
    check_person(caller)
    definition = flowable.definition(key, caller.tenant)
    check_can_count(caller, key, definition)
    # Hạn so với đúng một thời điểm cho mọi truy vấn; gửi dạng đến giây kèm Z, dạng đã thử với Flowable.
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    count = _Counter(key, caller.tenant, now)
    steps = [
        {"step": step, "name": name, "open": count.tasks(step), "overdue": count.tasks(step, overdue=True)}
        for step, (kind, name) in definition.nodes.items()
        if kind == "task"
    ]
    return {
        "process": key,
        "open": count.total("/query/process-instances", {}),
        "finished": count.total("/query/historic-process-instances", {"finished": True}),
        "overdue": count.tasks(None, overdue=True),
        "steps": steps,
        "counted_at": now,
    }


def check_can_count(caller: Caller, key: str, definition: flowable.Definition) -> None:
    """Người gọi có ít nhất một vai trò làm được một bước của quy trình; không thì 404 như quy trình không có.

    Cùng câu với flowable.definition, để người ngoài quy trình không biết tenant có quy trình đó hay không.
    Bảng phân cấp chỉ đọc khi vai trò viết trong BPMN không khớp và quy trình có bước đọc bảng.
    """
    if caller.roles & definition.groups:
        return
    if definition.authorities and caller.roles & db.authority_roles(caller.tenant, key):
        return
    raise Denied(404, f"Tenant chưa có quy trình '{key}'.")


class _Counter:
    """Truy vấn đếm của một quy trình trong một tenant, cùng một thời điểm so hạn."""

    def __init__(self, key: str, tenant: str, now: str):
        self.key, self.tenant, self.now = key, tenant, now

    def tasks(self, step: str | None, *, overdue: bool = False) -> int:
        """Bước đang chờ, của một bước hay cả quy trình; overdue: chỉ bước có hạn trước `now`."""
        query: dict[str, object] = {"taskDefinitionKey": step} if step else {}
        if overdue:
            query["dueBefore"] = self.now
        return self.total("/query/tasks", query, step)

    def total(self, path: str, query: dict[str, object], step: str | None = None) -> int:
        scope = {"processDefinitionKey": self.key, "tenantId": self.tenant}
        response = flowable._call("POST", path, json=scope | query | {"start": 0, "size": 1})
        flowable._ensure_ok(response, "đếm hồ sơ")
        page = response.json()
        if not all(self._matches(row, step) for row in page["data"]):
            raise Denied(
                502,
                f"Flowable trả dòng ngoài điều kiện khi đếm {path} của '{self.key}'; báo người vận hành kiểm "
                "phiên bản Flowable.",
            )
        return page["total"]

    def _matches(self, row: dict, step: str | None) -> bool:
        if row.get("tenantId") != self.tenant or flowable.process_key(row["processDefinitionId"]) != self.key:
            return False
        return step is None or row.get("taskDefinitionKey") == step
