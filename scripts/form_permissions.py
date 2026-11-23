# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Đọc quyền Hasura của gói (hasura/*.yaml, cùng định dạng core/hasura/tables.yaml) cho
# scripts/check-form-config.py: bảng theo trường gốc GraphQL, quyền của một vai trò, và cột mà quyền gắn với
# tenant của token. Tách khỏi tệp kiểm để luật của biểu mẫu không lẫn với việc kiểm dạng tệp quyền.

import yaml

TENANT = "x-hasura-tenant-id"
KINDS = ("select_permissions", "insert_permissions")


def _rule_problem(kind: str, rule: object) -> str | None:
    if not isinstance(rule, dict) or not isinstance(rule.get("role"), str):
        return f"một mục của {kind} thiếu role"
    where = f"quyền {kind}, vai trò {rule['role']}"
    permission = rule.get("permission")
    if not isinstance(permission, dict):
        return f"{where} thiếu permission"
    columns = permission.get("columns", [])
    if columns != "*" and not (isinstance(columns, list) and all(isinstance(c, str) for c in columns)):
        return f'columns của {where}, cần là danh sách tên cột hoặc "*"'
    for key in ("set", "check", "filter"):
        if permission.get(key) is not None and not isinstance(permission[key], dict):
            return f"{key} của {where}, cần là một bảng khóa: giá trị"
    return None


def _entry_problem(entry: object) -> str | None:
    table = entry.get("table") if isinstance(entry, dict) else None
    if not isinstance(table, dict) or not all(isinstance(table.get(k), str) for k in ("schema", "name")):
        return "thiếu table: { schema, name }"
    for kind in KINDS:
        rules = entry.get(kind) or []
        if not isinstance(rules, list):
            return f"{kind} cần là danh sách"
        for rule in rules:
            problem = _rule_problem(kind, rule)
            if problem:
                return problem
    return None


def tables_of(paths: list[str]) -> dict[str, dict]:
    """Bảng theo trường gốc GraphQL <lược đồ>_<bảng>. Tệp sai dạng thì ném ValueError chỉ tệp và mục.

    Không kiểm dạng ở đây thì một mục quyền thiếu role làm lệnh kiểm văng KeyError, người sửa chỉ thấy
    traceback.
    """
    tables = {}
    for path in paths:
        with open(path, encoding="utf-8") as file:
            entries = yaml.safe_load(file) or []
        if not isinstance(entries, list):
            raise ValueError(f"{path}: cần một danh sách bảng (- table: ...)")
        for index, entry in enumerate(entries, 1):
            problem = _entry_problem(entry)
            if problem:
                raise ValueError(f"{path}: mục {index}: {problem}; sửa theo dạng của core/hasura/tables.yaml")
            tables[f"{entry['table']['schema']}_{entry['table']['name']}"] = entry
    return tables


def permission(table: dict, kind: str, role: str) -> dict | None:
    return next((p["permission"] for p in table.get(kind) or [] if p["role"] == role), None)


def _is_tenant(value: object) -> bool:
    # Hasura so tên biến phiên không phân biệt hoa thường.
    return isinstance(value, str) and value.lower() == TENANT


def tenant_columns(allowed: dict) -> set[str]:
    """Cột của chính bảng mà quyền thêm dòng gắn với tenant của token: cột `set` đặt từ biến tenant, và cột
    mà `check` so `_eq` với biến đó ở cấp đầu hay trong `_and`. Điều kiện đi qua quan hệ nói về cột của bảng
    khác nên không tính; `_or`, `_not` không chắc chắn giới hạn tenant nên cũng không tính.
    """
    columns = {name for name, value in (allowed.get("set") or {}).items() if _is_tenant(value)}
    pending = [allowed.get("check") or {}]
    while pending:
        rule = pending.pop()
        for key, value in rule.items():
            if key == "_and" and isinstance(value, list):
                pending += [item for item in value if isinstance(item, dict)]
            elif not key.startswith("_") and isinstance(value, dict) and _is_tenant(value.get("_eq")):
                columns.add(key)
    return columns
