# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Trả lời câu hỏi dữ liệu (ADR 0027): đọc cấu hình của mục menu bằng token người hỏi, cho câu GraphQL qua
# guard (guard.py), chạy đúng câu đó qua cổng tới Hasura bằng token người hỏi với vai trò `user`, rồi dựng
# bảng theo khai báo của gói. Bảng, cột được phép chỉ đến từ mục menu mà Hasura trả cho tenant trong token,
# không bao giờ từ thân yêu cầu. Quyền theo dòng do Hasura quyết định; ở đây không lọc lại vì nguồn không có
# cột tenant.

import json
import logging

import httpx

from . import guard
from .config import settings
from .errors import Denied
from .retrieval import Caller
from .schemas import DataAnswer, DataColumn, DataQuery, DataTable

log = logging.getLogger("assistant.data")
_client = httpx.Client(timeout=10)

ITEM_QUERY = """
query Item($app: String!, $item: String!) {
  platform_menu_items(where: {app: {_eq: $app}, item: {_eq: $item}}) { component config roles }
}
"""
# Lý do chung: lỗi của Hasura có thể nêu tên bảng, cột hay quyền mà người hỏi không được biết.
HASURA_REFUSED = (
    "API dữ liệu từ chối câu truy vấn này; câu đã qua guard nhưng không chạy được với quyền của bạn."
)


class _HasuraRefused(Exception):
    pass


def _post(caller: Caller, body: dict) -> dict:
    # Vai trò ghi rõ: token của quản trị có cả tenant_admin, mà trợ lý chỉ đọc với quyền của vai trò user.
    headers = {"Authorization": f"Bearer {caller.token}", "X-Hasura-Role": "user"}
    try:
        response = _client.post(settings.graphql_url, json=body, headers=headers)
        payload = response.json()
    except (httpx.HTTPError, ValueError) as error:
        log.error("Không gọi được GraphQL cho câu hỏi dữ liệu: %s", error)
        raise Denied(503, "Không đọc được dữ liệu; báo người vận hành kiểm tra `make ps`.") from error
    # Cổng hay Hasura quá tải, lỗi: không phải câu bị từ chối, nên báo lỗi (nhật ký ghi `failed`).
    if response.status_code == 429 or response.status_code >= 500:
        log.error("GraphQL trả %s: %s", response.status_code, str(payload)[:2000])
        raise Denied(503, "API dữ liệu đang quá tải hay gặp lỗi; thử lại sau ít phút.")
    if not response.is_success or payload.get("errors") or not isinstance(payload.get("data"), dict):
        log.error("GraphQL trả %s: %s", response.status_code, str(payload)[:2000])
        raise _HasuraRefused
    return payload["data"]


def data_config(caller: Caller, app: str, item: str) -> dict:
    """Khối `data` của mục menu; mục không có trong tenant của token, hay không hỏi dữ liệu, là 404."""
    try:
        data = _post(caller, {"query": ITEM_QUERY, "variables": {"app": app, "item": item}})
    except _HasuraRefused as error:
        raise Denied(
            502, "API dữ liệu từ chối đọc mục menu; báo người vận hành xem log của assistant."
        ) from error
    rows = data.get("platform_menu_items") or []
    row = rows[0] if len(rows) == 1 and rows[0].get("component") == "assistant" else {}
    config = row.get("config")
    # Mục khai `roles` chỉ dành cho các vai trò đó, như menu của giao diện (ADR 0023); người hỏi không có vai
    # trò nào trong đó nhận cùng 404 như mục không có, để không lộ là mục tồn tại.
    allowed = row.get("roles") or []
    if allowed and not set(allowed) & set(caller.roles):
        config = None
    if not isinstance(config, dict) or not isinstance(config.get("data"), dict):
        raise Denied(404, f"Đơn vị của bạn không có mục menu {app}/{item} hỏi dữ liệu.")
    return config["data"]


def refuse(reason: str, query: str) -> DataAnswer:
    return DataAnswer(outcome="refused", reason=reason, query=query, tables=[])


def answer(caller: Caller, request: DataQuery, data: dict) -> DataAnswer:
    try:
        allow = guard.allowlist(data)
    except (KeyError, TypeError, ValueError) as error:
        log.error("Cấu hình trợ lý dữ liệu %s/%s sai: %s", request.app, request.item, error)
        raise Denied(
            502, "Cấu hình trợ lý dữ liệu của mục này sai; báo người quản trị cài lại gói."
        ) from error
    try:
        checked = guard.check(request.query, allow)
    except guard.Refused as refused:
        return refuse(refused.reason, request.query)
    # Không thử lại hay sửa câu: lỗi sau guard thường là quyền hay kiểu dữ liệu, chạy lại cũng vậy.
    try:
        tables = _tables(checked, _post(caller, {"query": checked.query}))
    except _HasuraRefused:
        return refuse(HASURA_REFUSED, request.query)
    return DataAnswer(outcome="data", reason=None, query=checked.query, tables=tables)


def _tables(checked: guard.Checked, data: dict) -> list[DataTable]:
    tables = []
    for table in checked.tables:
        value = data.get(table.field)
        for step in table.rows_at:
            value = value.get(step) if isinstance(value, dict) else None
        rows = value if table.many else ([] if value is None else [value])
        if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
            log.error("Hasura trả %s không đúng hình dạng của câu đã kiểm", table.field)
            raise _HasuraRefused
        columns = [DataColumn(key=cell.key, label=cell.label) for cell in table.columns]
        cells = [{cell.key: _cell(_at(row, cell.path)) for cell in table.columns} for row in rows]
        tables.append(DataTable(title=table.title, columns=columns, rows=cells))
    return tables


def _at(row: dict, path: tuple[str, ...]) -> object:
    value: object = row
    for step in path:
        # Quan hệ một-một không có dòng đích thì Hasura trả null; ô đó trống.
        value = value.get(step) if isinstance(value, dict) else None
    return value


def _cell(value: object) -> str | int | float | bool | None:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    # Cột jsonb hay mảng: giữ nguyên nội dung dưới dạng chữ, giao diện không diễn giải.
    return json.dumps(value, ensure_ascii=False)
