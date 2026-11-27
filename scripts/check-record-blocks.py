# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm khối trong chi tiết dòng của danh mục (detail.blocks, ADR 0068) và liên kết chung tới chi tiết dòng
# (record của lớp bản đồ, của biểu đồ trong bảng điều hành) với gói chứa chúng, những luật JSON Schema không
# diễn đạt được: khối trỏ tới một mục có thật của gói, không phải trang, kiểu có trong schema của thành
# phần; attach chỉ ở thành phần biết lọc theo dòng, attach.source là một nguồn của khối, và với bảng thì vai
# trò mà khối dùng đọc bảng đó đọc được attach.column trong quyền Hasura của gói (đọc qua
# scripts/form_permissions.py). Thiếu bước này, khối gắn sai cột chỉ báo lỗi khi người xem mở một dòng, hay
# lặng lẽ hiện mọi dòng khi source gõ sai. Liên kết trỏ tới mục danh mục của gói, cột khóa đọc được bằng vai
# trò của lớp hay khối. Theo dõi hồ sơ gắn theo biến của quy trình: biến lõi đặt và trường của bước (đọc từ
# BPMN như workflow-api, scripts/workflow_fields.py) bị từ chối, vì workflow-api cũng từ chối lọc theo chúng.
# Gọi từ scripts/contracts.sh: --app <app.yaml>; --hasura, --bpmn và --config <mục>=<tệp> thay quyền, BPMN và
# tệp cấu hình của mục để kiểm ví dụ của hợp đồng.

import argparse
import glob
import os
import sys
import xml.etree.ElementTree as ET

import yaml
from app_entries import entries
from form_permissions import permission, tables_of
from workflow_fields import BPMN, fields_api

# Thành phần biết thêm điều kiện của dòng đang xem vào truy vấn (blockContext.ts).
ATTACHABLE = ("catalog", "map", "dashboard", "cases")
# Biến do lõi đặt, cùng danh sách với $defs.variable của contracts/catalog.schema.json; workflow-api không
# cho lọc hồ sơ theo chúng (policy.visible_variables).
RESERVED = {"initiator", "initiatorName", "tenant", "idempotencyKey"}
RESERVED_PREFIX = "authority_"


def read_yaml(path: str):
    with open(path, encoding="utf-8") as file:
        return yaml.safe_load(file)


def variants_of(component: str) -> list[str]:
    path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "contracts", f"{component}.schema.json"
    )
    if not os.path.isfile(path):
        return []
    with open(path, encoding="utf-8") as file:
        return list(yaml.safe_load(file).get("properties", {}).get("variant", {}).get("enum", []))


def sources_of(component: str, config: dict) -> dict[str, set[str] | None]:
    """Nguồn của một khối -> vai trò đọc nó; None là nguồn không qua Hasura (khóa quy trình của cases)."""
    found: dict[str, set[str] | None] = {}
    if component == "catalog":
        found[config["source"]] = {"user"}
    elif component == "map":
        for layer in config.get("layers", []):
            found.setdefault(layer["source"], set()).add(layer.get("role", "user"))
    elif component == "dashboard":
        for panel in config.get("panels", []):
            if "graphql" in panel:
                found.setdefault(panel["graphql"]["field"], set()).add(panel.get("role", "user"))
    elif component == "cases":
        found = dict.fromkeys(config.get("processes", []))
    return found


def readable(tables: dict, source: str, role: str, column: str) -> str | None:
    """Lời báo khi vai trò không đọc được cột của nguồn; None khi đọc được."""
    if source not in tables:
        return f"'{source}' không phải bảng trong quyền Hasura của gói"
    allowed = permission(tables[source], "select_permissions", role)
    if allowed is None:
        return f"vai trò '{role}' không đọc được '{source}'"
    columns = allowed.get("columns", [])
    if columns != "*" and column not in columns:
        return f"vai trò '{role}' không đọc được cột '{column}' của '{source}'"
    return None


def step_fields(bpmn_files: list[str]) -> dict[str, set[str] | None]:
    """Khóa quy trình -> trường của mọi bước.

    None khi quy trình có bước người làm mà không khai trường nào: khi đó workflow-api không trả biến nào cho
    người lập và không cho lọc theo biến nào.
    """
    found: dict[str, set[str] | None] = {}
    for path in bpmn_files:
        # Tệp BPMN nằm trong repo, do người đóng góp viết, không phải dữ liệu từ bên ngoài.
        root = ET.parse(path).getroot()  # noqa: S314
        for process in root.iter(f"{BPMN}process"):
            tasks = list(process.iter(f"{BPMN}userTask"))
            names = {prop.get("id", "") for task in tasks for prop in fields_api.properties(task)}
            found[process.get("id", "")] = None if tasks and not names else names
    return found


def variable_problem(process: str, column: str, fields: dict) -> str | None:
    """Lời báo khi workflow-api sẽ từ chối lọc hồ sơ của `process` theo biến `column`."""
    hidden = fields.get(process, set())
    if column in RESERVED or column.startswith(RESERVED_PREFIX):
        why = "là biến do lõi đặt"
    elif hidden is None or column in hidden:
        why = f"là trường của bước trong '{process}'"
    else:
        return None
    return f"attach.column: '{column}' {why}, người lập không thấy nên không lọc được"


def attach_problems(component: str, config: dict, attach: dict, context: dict) -> list[str]:
    if component not in ATTACHABLE:
        return [f"{component} không lọc được theo dòng đang xem, bỏ attach"]
    sources = sources_of(component, config)
    source, column = attach["source"], attach["column"]
    if source not in sources:
        choice = ", ".join(sorted(sources)) or "khối không có nguồn nào"
        return [f"attach.source '{source}' không phải nguồn của khối ({choice})"]
    roles = sources[source]
    if roles is None:
        problem = variable_problem(source, column, context["fields"])
        return [problem] if problem else []
    problems = [readable(context["tables"], source, role, column) for role in sorted(roles)]
    return [f"attach.column: {problem}" for problem in problems if problem]


def block_problems(block: dict, items: dict[str, dict], configs: dict, context: dict) -> list[str]:
    name = block["item"]
    entry = items.get(name)
    if entry is None:
        return [f"không có mục '{name}' trong menu hay blocks của gói"]
    component = entry["component"]
    if component == "page":
        return [f"mục '{name}' là một trang; trong chi tiết dòng chỉ đặt thành phần"]
    problems = []
    variant = block.get("variant")
    allowed = variants_of(component)
    if variant is not None and variant not in allowed:
        choice = ", ".join(allowed) if allowed else "thành phần này chưa có kiểu nào, bỏ variant"
        problems.append(f"{component} không có kiểu '{variant}' ({choice})")
    if "attach" in block:
        problems += attach_problems(component, configs.get(name, {}), block["attach"], context)
    return problems


def nodes_of(node: dict, label: str):
    """Loại đối tượng ngoài cùng và mọi loại con lồng trong nó, kèm tên để chỉ chỗ lỗi."""
    yield label, node
    for child in node.get("detail", {}).get("children", []):
        yield from nodes_of(child, f"{label} > {child['label']}")


def catalog_problems(catalog: dict, items: dict, configs: dict, context: dict) -> list[str]:
    errors = []
    for label, node in nodes_of(catalog, catalog["title"]):
        for index, block in enumerate(node.get("detail", {}).get("blocks", []), start=1):
            errors += [f"{label}: khối {index}: {p}" for p in block_problems(block, items, configs, context)]
    return errors


def link_problems(record: dict, roles: set[str], source: str, items: dict, tables: dict) -> list[str]:
    target = items.get(record["item"])
    if target is None or target["component"] != "catalog":
        return [f"record.item '{record['item']}' không phải mục danh mục của gói"]
    problems = [readable(tables, source, role, record["column"]) for role in sorted(roles)]
    return [f"record.column: {problem}" for problem in problems if problem]


def links_of(component: str, config: dict):
    """Liên kết tới chi tiết dòng của một mục: (chỗ khai, record, vai trò, nguồn)."""
    if component == "map":
        for layer in config.get("layers", []):
            if "record" in layer:
                yield f"lớp '{layer['id']}'", layer["record"], {layer.get("role", "user")}, layer["source"]
    if component == "dashboard":
        for panel in config.get("panels", []):
            record = (panel.get("chart") or {}).get("record")
            if record is None:
                continue
            # Nguồn REST (workflow, context) không có dòng của bảng nào để mở.
            if "graphql" not in panel:
                yield f"khối '{panel['id']}'", None, set(), ""
            else:
                yield f"khối '{panel['id']}'", record, {panel.get("role", "user")}, panel["graphql"]["field"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", required=True)
    parser.add_argument("--hasura", nargs="*")
    parser.add_argument("--bpmn", nargs="*")
    # Thư mục đọc tệp cấu hình của mục menu thay cho thư mục gói (scripts/contracts.sh package --configs).
    parser.add_argument("--configs")
    parser.add_argument(
        "--config", action="append", default=[], help="<mục>=<tệp>, thay tệp cấu hình của mục"
    )
    args = parser.parse_args()
    directory = os.path.dirname(args.app)
    try:
        app = read_yaml(args.app)
        hasura = os.path.join(directory, app["hasura"]) if app.get("hasura") else None
        tables = tables_of(args.hasura or (sorted(glob.glob(f"{hasura}/*.yaml")) if hasura else []))
        bpmn = [os.path.join(directory, path) for path in app.get("workflows", [])]
        context = {"tables": tables, "fields": step_fields(args.bpmn if args.bpmn is not None else bpmn)}
        items = {entry["id"]: entry for entry in entries(app)}
        paths = {name: os.path.join(args.configs or directory, entry["config"]) for name, entry in items.items()}
        paths |= dict(override.split("=", 1) for override in args.config)
        # Chỉ đọc tệp có thật: ví dụ của hợp đồng khai tệp không tồn tại cho mục không được --config thay.
        configs = {name: read_yaml(path) for name, path in paths.items() if os.path.exists(path)}
        errors = []
        for name, entry in items.items():
            config = configs.get(name)
            if config is None:
                continue
            at = paths[name]
            if entry["component"] == "catalog":
                errors += [f"{at}: {e}" for e in catalog_problems(config, items, configs, context)]
            for where, record, roles, source in links_of(entry["component"], config):
                if record is None:
                    errors.append(f"{at}: {where}: record chỉ dùng với nguồn graphql")
                    continue
                errors += [f"{at}: {where}: {e}" for e in link_problems(record, roles, source, items, tables)]
    except (OSError, ValueError, KeyError, TypeError, AttributeError, yaml.YAMLError) as error:
        errors = [f"không đọc được tệp: {error}"]
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
