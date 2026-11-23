# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm mục `data` của cấu hình trợ lý (contracts/assistant.schema.json, ADR 0027) với chủ sở hữu của nó, những
# luật JSON Schema không diễn đạt được: mỗi nguồn là một bảng chủ sở hữu khai trong tệp quyền Hasura, cột nằm
# trong quyền đọc của vai trò `user`, `aggregate: true` thì quyền đó bật allow_aggregations, quan hệ là quan
# hệ một-một tới đúng bảng của nguồn đích, và mọi câu mẫu qua guard của trợ lý
# (platform/services/assistant/app/guard.py, dùng chung chứ không chép). Thiếu bước này, lỗi chỉ lộ ra khi
# người dùng bấm câu mẫu: guard hay Hasura từ chối. Gọi qua scripts/contracts.sh (make check-fast, và bộ cài
# gói trước khi ghi gì):
#   --owner <apps/<gói> | core> <tệp cấu hình trợ lý...>
# Chủ sở hữu `core` là mục mẫu của lõi, đọc quyền ở core/hasura/ và platform/schema/hasura/.

import argparse
import glob
import importlib.util
import os
import sys

import yaml

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORE_DECLARATIONS = ("core/hasura", "platform/schema/hasura")


def load_guard():
    # Nạp từ đường dẫn thay vì import gói app: app/__init__ của dịch vụ có thể kéo theo app.config, mà config
    # dừng khi thiếu biến môi trường của container.
    path = os.path.join(REPO, "platform", "services", "assistant", "app", "guard.py")
    spec = importlib.util.spec_from_file_location("assistant_guard", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def declared_tables(owner: str) -> dict[str, dict]:
    """Bảng chủ sở hữu khai, theo tên trường gốc Hasura đặt cho lược đồ khác public: <lược đồ>_<bảng>."""
    if owner == "core":
        directories = [os.path.join(REPO, path) for path in CORE_DECLARATIONS]
    else:
        with open(os.path.join(owner, "app.yaml"), encoding="utf-8") as file:
            directories = [os.path.join(owner, yaml.safe_load(file)["hasura"])]
    tables = {}
    for directory in directories:
        for path in sorted(glob.glob(os.path.join(directory, "*.yaml"))):
            with open(path, encoding="utf-8") as file:
                for entry in yaml.safe_load(file) or []:
                    table = entry["table"]
                    tables[f"{table['schema']}_{table['name']}"] = entry
    return tables


def user_permission(entry: dict) -> dict | None:
    for item in entry.get("select_permissions", []):
        if item["role"] == "user":
            return item["permission"]
    return None


def relation_target(entry: dict, name: str) -> str | None:
    for relation in entry.get("object_relationships", []):
        if relation["name"] == name:
            remote = relation["using"].get("manual_configuration", {}).get("remote_table", {})
            return f"{remote.get('schema')}_{remote.get('name')}"
    return None


def source_problems(source: dict, tables: dict[str, dict], owner: str) -> list[str]:
    field = source["field"]
    # Khớp đúng tên bảng, không theo tiền tố: tiền tố cũng khớp <bảng>_by_pk hay <bảng>_aggregate.
    if field not in tables:
        return [f"nguồn {field} không phải bảng hay view mà {owner} khai trong tệp quyền Hasura"]
    permission = user_permission(tables[field])
    if permission is None:
        return [f"nguồn {field}: vai trò user không có quyền đọc"]
    found = []
    missing = sorted({column["name"] for column in source["columns"]} - set(permission.get("columns", [])))
    if missing:
        found.append(f"nguồn {field}: cột {', '.join(missing)} không nằm trong quyền đọc của vai trò user")
    if source.get("aggregate") and not permission.get("allow_aggregations"):
        found.append(f"nguồn {field}: aggregate cần allow_aggregations trong quyền đọc của vai trò user")
    for relation in source.get("relations", []):
        target = relation_target(tables[field], relation["name"])
        if target is None:
            found.append(
                f"nguồn {field}: {relation['name']} không phải quan hệ một-một (object relationship)"
            )
        elif target != relation["source"]:
            found.append(
                f"nguồn {field}: quan hệ {relation['name']} trỏ tới {target}, không phải {relation['source']}"
            )
    return found


def config_problems(path: str, config: dict, tables: dict[str, dict], owner: str, guard) -> list[str]:
    data = config.get("data")
    if data is None:
        return []
    found = []
    fields = [source["field"] for source in data["sources"]]
    if len(fields) != len(set(fields)):
        found.append("có nguồn khai hai lần")
    for source in data["sources"]:
        found += source_problems(source, tables, owner)
    try:
        allow = guard.allowlist(data)
    except ValueError as error:
        return [f"{path}: {problem}" for problem in [*found, str(error)]]
    ids = [example["id"] for example in data["examples"]]
    if len(ids) != len(set(ids)):
        found.append("có câu mẫu trùng id")
    for example in data["examples"]:
        try:
            guard.check(example["query"], allow)
        except guard.Refused as refused:
            found.append(f"câu mẫu {example['id']} không qua guard: {refused.reason}")
    return [f"{path}: {problem}" for problem in found]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--owner", required=True, help="thư mục gói (apps/<gói>) hay core")
    parser.add_argument("configs", nargs="+")
    args = parser.parse_args()
    guard = load_guard()
    try:
        tables = declared_tables(args.owner)
        errors = []
        for path in args.configs:
            with open(path, encoding="utf-8") as file:
                errors += config_problems(path, yaml.safe_load(file), tables, args.owner, guard)
    except (OSError, yaml.YAMLError, KeyError) as error:
        errors = [f"không đọc được khai báo của {args.owner}: {error}"]
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
