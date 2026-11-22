# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm cấu hình biểu mẫu (contracts/form.schema.json) với gói chứa nó, những luật JSON Schema không diễn đạt
# được (ADR 0030): quy trình đích có trong BPMN của gói; không trường nào là biến quyết định (ADR 0025) hay
# trùng biến mà bước của quy trình ghi; bước lấy tên hồ sơ từ một biến thì biểu mẫu có trường đó; bảng, cột
# của lệnh thêm dòng và của danh sách chọn thuộc gói và nằm trong quyền Hasura của vai trò; mục menu sau khi
# gửi có trong app.yaml. Thiếu bước này, lỗi chỉ lộ ra khi người dùng bấm Gửi. Thành phần kiểm lại luật tên
# lúc chạy. Gọi từ scripts/contracts.sh: --app <app.yaml>; mặc định đọc BPMN, khai báo bước, quyền Hasura và
# mọi biểu mẫu trên menu theo app.yaml, còn --bpmn, --steps, --hasura, --form thay từng phần để kiểm một biểu
# mẫu với tệp mẫu.

import argparse
import glob
import importlib.util
import os
import sys
import xml.etree.ElementTree as ET

import yaml

BPMN = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_decisions():
    # Nạp theo đường dẫn thay vì import gói workflow-api: tệp chỉ dùng thư viện chuẩn, còn gói kéo theo
    # FastAPI và config.py đòi biến môi trường. Dùng chung một hàm thì check-fast và workflow-api không lệch
    # nhau về biến nào là biến quyết định.
    path = os.path.join(REPO, "core", "workflow-api", "app", "decisions.py")
    spec = importlib.util.spec_from_file_location("decisions", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.decision_variables


def read_yaml(path: str):
    with open(path, encoding="utf-8") as file:
        return yaml.safe_load(file)


def bpmn_by_key(paths: list[str]) -> dict[str, bytes]:
    found = {}
    for path in paths:
        with open(path, "rb") as file:
            content = file.read()
        # Tệp BPMN nằm trong repo, do người đóng góp viết, không phải dữ liệu từ bên ngoài.
        for process in ET.fromstring(content).iter(f"{BPMN}process"):  # noqa: S314
            found[process.get("id")] = content
    return found


def tables_of(paths: list[str]) -> dict[str, dict]:
    tables = {}
    for path in paths:
        for entry in read_yaml(path) or []:
            tables[f"{entry['table']['schema']}_{entry['table']['name']}"] = entry
    return tables


def permission(table: dict, kind: str, role: str) -> dict | None:
    return next((p["permission"] for p in table.get(kind, []) if p["role"] == role), None)


def step_names(steps: list[dict], process: str) -> tuple[set[str], list[str]]:
    """Biến mà các bước của quy trình ghi (trường biểu mẫu, biến của nút) và các biến làm tên hồ sơ."""
    written, titles = set(), []
    for declaration in steps:
        if declaration.get("process") != process:
            continue
        for step in declaration["steps"].values():
            written |= set((step.get("form") or {}).get("properties", {}))
            for action in step["actions"]:
                written |= set(action["variables"])
            if step.get("title"):
                titles.append(step["title"])
    return written, titles


def process_problems(form: dict, names: list[str], context: dict) -> list[str]:
    key = form["submit"]["process"]
    if key not in context["bpmn"]:
        return [
            f"submit.process '{key}' không có trong BPMN của gói; sửa khóa hoặc thêm quy trình vào workflows"
        ]
    errors = []
    decisions = context["decision_variables"](context["bpmn"][key], key)
    written, titles = step_names(context["steps"], key)
    for name in names:
        if name in decisions:
            errors.append(
                f"trường '{name}' là biến quyết định của quy trình '{key}'; người lập không được đặt sẵn"
            )
        elif name in written:
            errors.append(
                f"trường '{name}' trùng biến mà một bước của quy trình '{key}' ghi; giá trị người lập "
                "điền sẽ hiện dưới nhãn của người xử lý, đổi tên trường"
            )
    for title in titles:
        if title not in written and title not in names:
            errors.append(
                f"bước của quy trình '{key}' lấy tên hồ sơ từ biến '{title}'; thêm trường '{title}'"
            )
    return errors


def insert_problems(form: dict, names: list[str], role: str, tables: dict) -> list[str]:
    target = form["submit"]["insert"]
    if target not in tables:
        return [f"submit.insert '{target}' không phải bảng trong quyền Hasura của gói"]
    allowed = permission(tables[target], "insert_permissions", role)
    if allowed is None:
        return [f"vai trò '{role}' không có quyền thêm dòng vào '{target}'; sửa role hoặc quyền của gói"]
    errors = []
    for name in names:
        if name in (allowed.get("set") or {}):
            errors.append(f"cột '{name}' do Hasura đặt từ token (set); bỏ trường này khỏi biểu mẫu")
        elif allowed.get("columns") != "*" and name not in allowed.get("columns", []):
            errors.append(f"vai trò '{role}' không được ghi cột '{name}' của '{target}'")
    return errors


def source_problems(field: dict, earlier: list[str], role: str, tables: dict) -> list[str]:
    source, label = field["source"], f"trường '{field['name']}'"
    where = source.get("where")
    errors = []
    if where and where["field"] not in earlier:
        errors.append(f"{label} lọc theo trường '{where['field']}', không phải trường đứng trước nó")
    if source["table"] not in tables:
        return [*errors, f"{label} đọc bảng '{source['table']}', không phải bảng trong quyền Hasura của gói"]
    allowed = permission(tables[source["table"]], "select_permissions", role)
    if allowed is None:
        return [*errors, f"{label}: vai trò '{role}' không đọc được '{source['table']}'"]
    for column in [source["value"], source["label"], *([where["column"]] if where else [])]:
        if allowed.get("columns") != "*" and column not in allowed.get("columns", []):
            errors.append(f"{label}: vai trò '{role}' không đọc được cột '{column}' của '{source['table']}'")
    return errors


def form_problems(form: dict, entry: dict | None, context: dict) -> list[str]:
    names = [field["name"] for field in form["fields"]]
    role = form.get("role", "user")
    errors = [
        f"trường '{name}' được khai hai lần" for name in sorted({n for n in names if names.count(n) > 1})
    ]
    for index, field in enumerate(form["fields"]):
        if "min" in field and "max" in field and field["min"] > field["max"]:
            errors.append(f"trường '{field['name']}' có min lớn hơn max")
        if "source" in field:
            errors += source_problems(field, names[:index], role, context["tables"])
    if "process" in form["submit"]:
        errors += process_problems(form, names, context)
    else:
        errors += insert_problems(form, names, role, context["tables"])
    menu = form["done"].get("menu")
    if menu and menu not in context["menu"]:
        errors.append(f"done.menu '{menu}' không phải mục menu của gói")
    # Người thấy mục menu mà token không có vai trò của biểu mẫu chỉ gặp thông báo không dùng được; buộc mục
    # menu chỉ hiện cho đúng vai trò đó.
    if entry is not None and role != "user" and entry.get("roles") != [role]:
        errors.append(
            f"biểu mẫu dùng vai trò '{role}' nên mục menu '{entry['id']}' phải khai roles: [{role}]"
        )
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", required=True)
    parser.add_argument("--bpmn", nargs="*")
    parser.add_argument("--steps", nargs="*")
    parser.add_argument("--hasura", nargs="*")
    parser.add_argument("--form")
    args = parser.parse_args()
    directory = os.path.dirname(args.app)
    try:
        app = read_yaml(args.app)
        hasura = os.path.join(directory, app["hasura"]) if app.get("hasura") else None
        context = {
            "bpmn": bpmn_by_key(args.bpmn or [os.path.join(directory, p) for p in app.get("workflows", [])]),
            "steps": [read_yaml(p) for p in args.steps or sorted(glob.glob(f"{directory}/workflows/*.yaml"))],
            "tables": tables_of(args.hasura or (sorted(glob.glob(f"{hasura}/*.yaml")) if hasura else [])),
            "menu": {entry["id"] for entry in app.get("menu", [])},
            "decision_variables": load_decisions(),
        }
        if args.form:
            forms = [(args.form, None)]
        else:
            entries = [e for e in app.get("menu", []) if e["component"] == "form"]
            forms = [(os.path.join(directory, e["config"]), e) for e in entries]
        errors = []
        for path, entry in forms:
            errors += [f"{path}: {error}" for error in form_problems(read_yaml(path), entry, context)]
    except (ET.ParseError, OSError, ValueError, yaml.YAMLError) as error:
        errors = [f"không đọc được tệp: {error}"]
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
