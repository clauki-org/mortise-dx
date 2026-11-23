# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Gọi REST API của Flowable bằng tài khoản kỹ thuật. Chỉ module này biết đường dẫn và
# định dạng của Flowable; phần còn lại làm việc với dict đơn giản.

import logging
from collections.abc import Mapping
from dataclasses import dataclass, field

import httpx

from .authority import authority_steps
from .config import settings
from .decisions import decision_variables
from .fields import step_fields
from .policy import IDEMPOTENCY_VARIABLE, Denied

log = logging.getLogger("workflow-api.flowable")

_client = httpx.Client(
    base_url=f"{settings.flowable_url}/service",
    auth=(settings.flowable_user, settings.flowable_password),
    timeout=10,
)


def _call(method: str, path: str, **kwargs) -> httpx.Response:
    try:
        response = _client.request(method, path, **kwargs)
    except httpx.HTTPError as error:
        raise Denied(503, f"Không kết nối được Flowable ({error}); kiểm tra `make ps`.") from error
    return response


def _ensure_ok(response: httpx.Response, action: str) -> None:
    if response.is_success:
        return
    try:
        detail = response.json().get("message") or response.text
    except ValueError:
        detail = response.text
    raise Denied(502, f"Flowable từ chối {action} ({response.status_code}): {detail}")


def _as_flowable(variables: dict[str, object]) -> list[dict[str, object]]:
    return [{"name": name, "value": value} for name, value in variables.items()]


def start(key: str, tenant: str, variables: dict[str, object]) -> dict:
    response = _call(
        "POST",
        "/runtime/process-instances",
        json={"processDefinitionKey": key, "tenantId": tenant, "variables": _as_flowable(variables)},
    )
    # Flowable trả 400 khi tenant chưa có quy trình với khóa này.
    if response.status_code == 400:
        raise Denied(404, f"Tenant chưa có quy trình '{key}'.")
    _ensure_ok(response, "khởi tạo quy trình")
    return response.json()


def started_with(
    tenant: str, key: str, initiator: str, idempotency_key: str, *, open_only: bool = False
) -> dict | None:
    """Quy trình `key` mà `initiator` đã khởi tạo với cùng Idempotency-Key.

    Mặc định tính cả quy trình đã kết thúc; open_only thì chỉ tính quy trình còn mở.
    """
    query: dict[str, object] = {
        "tenantId": tenant,
        "processDefinitionKey": key,
        "variables": [
            {"name": name, "value": value, "operation": "equals", "type": "string"}
            for name, value in (("initiator", initiator), (IDEMPOTENCY_VARIABLE, idempotency_key))
        ],
    }
    if open_only:
        query["finished"] = False
    response = _call("POST", "/query/historic-process-instances", json=query)
    _ensure_ok(response, "tìm quy trình đã khởi tạo")
    data = response.json()["data"]
    return data[0] if data else None


# Một trang của truy vấn task, và số trang tối đa cho một lần đọc bảng việc. Chạm trần thì ghi cảnh báo thay
# vì lặng lẽ bỏ task: người vận hành phải biết bảng việc của ai đang thiếu.
PAGE_SIZE = 200
MAX_PAGES = 10


def tasks(tenant: str | None, *, groups: list[str] | None = None, assignee: str | None = None) -> list[dict]:
    """Task đang chờ, đọc hết các trang; tenant None là mọi tenant. Theo `groups` thì chỉ task chưa nhận."""
    # Sắp theo id để các trang không chồng hay sót nhau khi đọc lần lượt.
    query: dict[str, object] = {"includeProcessVariables": True, "size": PAGE_SIZE, "sort": "id"}
    if tenant is not None:
        query["tenantId"] = tenant
    if groups is not None:
        query |= {"candidateGroupIn": groups, "unassigned": True}
    if assignee is not None:
        query["assignee"] = assignee
    found: list[dict] = []
    for _ in range(MAX_PAGES):
        response = _call("POST", "/query/tasks", json=query | {"start": len(found)})
        _ensure_ok(response, "truy vấn task")
        page = response.json()
        found += page["data"]
        if not page["data"] or len(found) >= page["total"]:
            return found
    log.warning(
        "Truy vấn task (tenant %s, nhóm %s, người nhận %s) có %s task, chỉ đọc %s",
        tenant or "mọi tenant",
        groups,
        assignee,
        page["total"],
        len(found),
    )
    return found


def task(task_id: str) -> dict | None:
    response = _call("POST", "/query/tasks", json={"taskId": task_id, "includeProcessVariables": True})
    _ensure_ok(response, "đọc task")
    data = response.json()["data"]
    return data[0] if data else None


def candidate_groups(task_id: str) -> frozenset[str]:
    response = _call("GET", f"/runtime/tasks/{task_id}/identitylinks")
    _ensure_ok(response, "đọc nhóm ứng viên")
    return frozenset(
        link["group"] for link in response.json() if link["type"] == "candidate" and link["group"]
    )


def claim_and_complete(task_id: str, assignee: str, variables: dict[str, object]) -> None:
    for body in (
        {"action": "claim", "assignee": assignee},
        {"action": "complete", "variables": _as_flowable(variables)},
    ):
        response = _call("POST", f"/runtime/tasks/{task_id}", json=body)
        # 409: task đã được người khác nhận giữa lúc kiểm quyền và lúc nhận.
        if response.status_code == 409:
            raise Denied(409, "Task vừa được người khác nhận.")
        _ensure_ok(response, "xử lý task")


# Định nghĩa quy trình đã deploy không bao giờ đổi, nên nhớ khóa của nó suốt đời tiến trình.
_process_keys: dict[str, str] = {}


def process_key(definition_id: str) -> str:
    # Mã định nghĩa chỉ có dạng `khóa:phiên bản:id` khi đủ ngắn; Flowable bỏ phần khóa khi mã dài quá
    # 64 ký tự, nên cắt chuỗi sẽ sai với khóa dài. Hỏi thẳng định nghĩa thay vì đoán.
    if definition_id not in _process_keys:
        response = _call("GET", f"/repository/process-definitions/{definition_id}")
        _ensure_ok(response, "đọc định nghĩa quy trình")
        _process_keys[definition_id] = response.json()["key"]
    return _process_keys[definition_id]


def instance(instance_id: str) -> dict | None:
    response = _call("GET", f"/history/historic-process-instances/{instance_id}")
    if response.status_code == 404:
        return None
    _ensure_ok(response, "đọc quy trình")
    return response.json()


@dataclass(frozen=True)
class Definition:
    # Biến quyết định (ADR 0025): người lập không được đặt sẵn.
    decisions: frozenset[str]
    # Bước đọc vai trò từ bảng phân cấp thẩm quyền (ADR 0028).
    authorities: frozenset[str]
    # id của userTask -> trường bước đó ghi (ADR 0031).
    fields: Mapping[str, frozenset[str]] = field(default_factory=dict)


# Điều lõi cần biết về một định nghĩa, theo mã định nghĩa; định nghĩa đã deploy không đổi nên nhớ suốt đời
# tiến trình. Không nhớ theo khóa quy trình: deploy phiên bản mới thì khóa giữ nguyên mà BPMN có thể khác.
_definitions: dict[str, Definition] = {}


def definition(key: str, tenant: str) -> Definition:
    """Định nghĩa của phiên bản mới nhất của quy trình `key`, tức bản sắp khởi tạo."""
    query = {"key": key, "tenantId": tenant, "latest": "true"}
    response = _call("GET", "/repository/process-definitions", params=query)
    _ensure_ok(response, "đọc định nghĩa quy trình")
    found = response.json()["data"]
    if not found:
        raise Denied(404, f"Tenant chưa có quy trình '{key}'.")
    return _load(found[0]["id"], key)


def definition_of(definition_id: str) -> Definition:
    """Định nghĩa mà một hồ sơ đang chạy, theo processDefinitionId của task.

    Không dùng phiên bản mới nhất: hồ sơ lập trước khi deploy lại vẫn chạy BPMN cũ, với bước và trường của nó.
    """
    return _load(definition_id, process_key(definition_id))


def _load(definition_id: str, key: str) -> Definition:
    if definition_id not in _definitions:
        response = _call("GET", f"/repository/process-definitions/{definition_id}/resourcedata")
        _ensure_ok(response, "đọc BPMN của quy trình")
        # Không đọc được thì từ chối: cho qua là để người lập hay người làm bước khác ghi được quyết định
        # và nội dung của người duyệt, và bước phân cấp không có vai trò.
        try:
            _definitions[definition_id] = Definition(
                decision_variables(response.content, key),
                authority_steps(response.content, key),
                step_fields(response.content, key),
            )
        except ValueError as error:
            reason = f"Không đọc được BPMN của quy trình '{key}' ({error}); deploy lại quy trình."
            raise Denied(502, reason) from error
    return _definitions[definition_id]
