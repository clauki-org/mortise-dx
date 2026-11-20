# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Gọi REST API của Flowable bằng tài khoản kỹ thuật. Chỉ module này biết đường dẫn và
# định dạng của Flowable; phần còn lại làm việc với dict đơn giản.

import httpx

from .config import settings
from .policy import IDEMPOTENCY_VARIABLE, Denied

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


def tasks(tenant: str, *, groups: list[str] | None = None, assignee: str | None = None) -> list[dict]:
    query: dict[str, object] = {"tenantId": tenant, "includeProcessVariables": True, "size": 200}
    if groups is not None:
        query |= {"candidateGroupIn": groups, "unassigned": True}
    if assignee is not None:
        query["assignee"] = assignee
    response = _call("POST", "/query/tasks", json=query)
    _ensure_ok(response, "truy vấn task")
    return response.json()["data"]


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
