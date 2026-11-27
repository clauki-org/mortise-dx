# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm cấu hình biểu mẫu (contracts/form.schema.json) với gói chứa nó, những luật JSON Schema không diễn đạt
# được (ADR 0030): quy trình đích có trong BPMN của gói; không trường nào là biến quyết định (ADR 0025) hay
# trùng biến mà bước của quy trình ghi; bước lấy tên hồ sơ từ một biến thì biểu mẫu có trường đó; bảng, cột
# của lệnh thêm dòng và của danh sách chọn thuộc gói và nằm trong quyền Hasura của vai trò (đọc qua
# scripts/form_permissions.py), không trường nào là cột tenant; mục menu sau khi gửi có trong app.yaml.
# Biểu mẫu mở từ danh mục (detail.edit, add của đối tượng con, ADR 0054) cũng được kiểm: biểu mẫu sửa chỉ
# sửa cột trong quyền update của vai trò, đọc được khóa, cột version và mọi trường để điền sẵn; biểu mẫu
# thêm dòng con ghi được cột nối về cha; lệnh chuyển thẻ của Kanban (kanban.move, ADR 0066) kiểm như biểu
# mẫu sửa chỉ có trường của cột. Thiếu bước này, lỗi chỉ lộ ra khi người dùng bấm Gửi. Thành phần
# kiểm lại luật tên lúc chạy. Gọi từ scripts/contracts.sh: --app <app.yaml>; mặc định đọc BPMN, khai báo
# bước, quyền Hasura, mọi biểu mẫu trên menu và mọi biểu mẫu trong danh mục theo app.yaml, còn --bpmn,
# --steps, --hasura, --form, --catalog thay từng phần để kiểm với tệp mẫu.

import argparse
import glob
import importlib.util
import os
import sys
import xml.etree.ElementTree as ET

import yaml
from app_entries import entries
from form_permissions import permission, tables_of, tenant_columns

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
    # tenant_id luôn bị cấm, kể cả khi quyền ghi nó trong columns thay vì set: người dùng không có gì để gõ
    # vào ô đó ngoài tenant của chính mình, gõ khác thì check chặn.
    tenant = tenant_columns(allowed) | {"tenant_id"}
    for name in names:
        if name in (allowed.get("set") or {}):
            errors.append(f"cột '{name}' do Hasura đặt từ token (set); bỏ trường này khỏi biểu mẫu")
        elif name in tenant:
            errors.append(
                f"cột '{name}' là cột tenant của '{target}'; trình duyệt không gửi tenant: bỏ trường này "
                f"khỏi biểu mẫu và đặt cột bằng set: {{ {name}: X-Hasura-Tenant-Id }} trong quyền thêm dòng "
                "của gói"
            )
        elif allowed.get("columns") != "*" and name not in allowed.get("columns", []):
            errors.append(f"vai trò '{role}' không được ghi cột '{name}' của '{target}'")
    return errors


def update_problems(form: dict, names: list[str], role: str, tables: dict, key: str) -> list[str]:
    target, version = form["submit"]["update"], form["submit"]["version"]
    if target not in tables:
        return [f"submit.update '{target}' không phải bảng trong quyền Hasura của gói"]
    allowed = permission(tables[target], "update_permissions", role)
    if allowed is None:
        return [f"vai trò '{role}' không có quyền sửa dòng của '{target}'; sửa role hoặc quyền của gói"]
    readable = permission(tables[target], "select_permissions", role)
    if readable is None:
        return [f"vai trò '{role}' không đọc được '{target}'; biểu mẫu sửa đọc lại dòng trước khi điền sẵn"]
    errors = []
    tenant = tenant_columns(allowed) | {"tenant_id"}
    writable = allowed.get("columns", [])
    for name in names:
        if name in (allowed.get("set") or {}) or name in tenant:
            errors.append(f"cột '{name}' của '{target}' gắn với tenant hay do Hasura đặt; bỏ trường này")
        elif name == version:
            errors.append(f"cột '{version}' là cột version do CSDL đặt; bỏ trường này khỏi biểu mẫu")
        elif writable != "*" and name not in writable:
            errors.append(f"vai trò '{role}' không được sửa cột '{name}' của '{target}'")
    # Hasura chỉ cho where của lệnh sửa dùng cột mà vai trò đọc được; thiếu thì mọi lần lưu đều bị từ chối.
    for column in dict.fromkeys([key, version, *names]):
        if readable.get("columns") != "*" and column not in readable.get("columns", []):
            errors.append(f"vai trò '{role}' không đọc được cột '{column}' của '{target}'")
    # Người dùng ghi được cột version thì giữ được giá trị cũ khi sửa, và lần sửa sau của người khác ghi đè.
    if writable == "*" or version in writable:
        errors.append(f"cột '{version}' nằm trong quyền update của vai trò '{role}'; bỏ khỏi columns")
    return errors


def via_problems(form: dict, via: str, role: str, tables: dict) -> list[str]:
    target = form["submit"]["insert"]
    allowed = permission(tables.get(target, {}), "insert_permissions", role)
    if allowed is None:
        return []
    if via in tenant_columns(allowed) or via in (allowed.get("set") or {}):
        return [f"cột nối về cha '{via}' gắn với tenant hay do Hasura đặt, không nhận khóa của dòng cha"]
    if allowed.get("columns") != "*" and via not in allowed.get("columns", []):
        return [f"vai trò '{role}' không ghi được cột nối về cha '{via}' của '{target}'"]
    return []


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


def form_problems(form: dict, entry: dict | None, context: dict, key: str | None = None) -> list[str]:
    """Lỗi của một biểu mẫu. key là khóa của loại đối tượng khi biểu mẫu mở từ danh mục để sửa dòng."""
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
    elif "update" in form["submit"]:
        if key is None:
            errors.append("submit.update chỉ dùng cho biểu mẫu mở từ danh mục (detail.edit)")
        else:
            errors += update_problems(form, names, role, context["tables"], key)
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


def move_problems(node: dict, context: dict) -> list[str]:
    """Chuyển thẻ của Kanban (ADR 0066) là lệnh sửa đúng một cột: kiểm như biểu mẫu sửa chỉ có trường đó."""
    kanban = node.get("kanban") or {}
    move = kanban.get("move")
    if not move:
        return []
    form = {"submit": {"update": node["source"], "version": move["version"]}}
    role = move.get("role", "user")
    errors = update_problems(form, [kanban["field"]], role, context["tables"], node.get("key", "id"))
    return [f"kanban.move: {error}" for error in errors]


def catalog_problems(node: dict, context: dict, where: str = "") -> list[str]:
    """Biểu mẫu trong danh mục: đích đúng bảng của danh sách, done.menu không dùng (hộp thoại tự đóng)."""
    detail = node.get("detail") or {}
    errors = move_problems(node, context)
    edit = detail.get("edit")
    if edit:
        at, form = f"{where}nút '{edit['label']}'", edit["form"]
        if form["submit"].get("update") != node["source"]:
            errors.append(f"{at}: biểu mẫu phải sửa bảng '{node['source']}' (submit.update)")
        else:
            errors += [f"{at}: {e}" for e in form_problems(form, None, context, node.get("key", "id"))]
        if "menu" in form["done"]:
            errors.append(f"{at}: done.menu không dùng cho biểu mẫu mở từ danh mục")
    for child in detail.get("children", []):
        add, inner = child.get("add"), f"{where}{child['id']}: "
        if add:
            at, form = f"{inner}nút '{add['label']}'", add["form"]
            role = form.get("role", "user")
            if form["submit"].get("insert") != child["source"]:
                errors.append(f"{at}: biểu mẫu phải thêm dòng vào '{child['source']}' (submit.insert)")
            else:
                errors += [f"{at}: {e}" for e in form_problems(form, None, context)]
                errors += [f"{at}: {e}" for e in via_problems(form, child["via"], role, context["tables"])]
            if child["via"] in [field["name"] for field in form["fields"]]:
                errors.append(f"{at}: cột '{child['via']}' nhận khóa của dòng cha, không khai thành trường")
            if "menu" in form["done"]:
                errors.append(f"{at}: done.menu không dùng cho biểu mẫu mở từ danh mục")
        errors += catalog_problems(child, context, inner)
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", required=True)
    # Thư mục đọc tệp cấu hình của mục menu thay cho thư mục gói (scripts/contracts.sh package --configs).
    parser.add_argument("--configs")
    parser.add_argument("--bpmn", nargs="*")
    parser.add_argument("--steps", nargs="*")
    parser.add_argument("--hasura", nargs="*")
    parser.add_argument("--form")
    parser.add_argument("--catalog")
    args = parser.parse_args()
    directory = os.path.dirname(args.app)
    try:
        app = read_yaml(args.app)
        hasura = os.path.join(directory, app["hasura"]) if app.get("hasura") else None
        context = {
            "bpmn": bpmn_by_key(args.bpmn or [os.path.join(directory, p) for p in app.get("workflows", [])]),
            "steps": [read_yaml(p) for p in args.steps or sorted(glob.glob(f"{directory}/workflows/*.yaml"))],
            "tables": tables_of(args.hasura or (sorted(glob.glob(f"{hasura}/*.yaml")) if hasura else [])),
            "menu": {entry["id"] for entry in entries(app)},
            "decision_variables": load_decisions(),
        }
        menu = entries(app)
        if args.form or args.catalog:
            forms = [(args.form, None)] if args.form else []
            catalogs = [args.catalog] if args.catalog else []
        else:
            base = args.configs or directory
            forms = [(os.path.join(base, e["config"]), e) for e in menu if e["component"] == "form"]
            catalogs = [os.path.join(base, e["config"]) for e in menu if e["component"] == "catalog"]
        errors = []
        for path, entry in forms:
            errors += [f"{path}: {error}" for error in form_problems(read_yaml(path), entry, context)]
        for path in catalogs:
            errors += [f"{path}: {error}" for error in catalog_problems(read_yaml(path), context)]
    except (ET.ParseError, OSError, ValueError, yaml.YAMLError) as error:
        errors = [f"không đọc được tệp: {error}"]
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
