# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm cấu hình bảng điều hành (contracts/dashboard.schema.json) với gói chứa nó, những luật JSON Schema
# không diễn đạt được (ADR 0033): nguồn là graphql (workflow, context chưa hỗ trợ); bảng của nguồn thuộc
# gói; vai trò của khối (bỏ trống là user) có quyền đọc bảng đó và mọi cột khối nhắc tới (đọc qua
# scripts/form_permissions.py); link trỏ tới mục menu khác của gói; không trùng tên khối, không trùng cột số
# của biểu đồ. Thiếu bước này, lỗi chỉ lộ ra khi người xem mở trang và khối báo lỗi quyền. Thành phần kiểm
# lại luật tên lúc chạy. Gọi từ scripts/contracts.sh: --app <app.yaml>; mặc định đọc quyền Hasura và mọi
# bảng điều hành trên menu theo app.yaml, còn --hasura, --dashboard thay từng phần để kiểm một cấu hình với
# tệp mẫu.

import argparse
import glob
import os
import sys

import yaml
from form_permissions import permission, tables_of

UNSUPPORTED = ("workflow", "context")


def read_yaml(path: str):
    with open(path, encoding="utf-8") as file:
        return yaml.safe_load(file)


def columns_of(panel: dict) -> list[str]:
    """Mọi cột mà câu truy vấn của khối đọc, lọc hay xếp theo, theo thứ tự khai."""
    source = panel["graphql"]
    names = [card["column"] for card in panel.get("cards", [])]
    chart = panel.get("chart")
    if chart:
        names += [chart["x"]["column"], *(y["column"] for y in chart["y"])]
        names += [detail["column"] for detail in chart.get("details", [])]
    if source.get("where"):
        names.append(source["where"]["field"])
    names += [order["column"] for order in source.get("order_by", [])]
    return list(dict.fromkeys(names))


def source_problems(panel: dict, label: str, tables: dict) -> list[str]:
    field, role = panel["graphql"]["field"], panel.get("role", "user")
    if field not in tables:
        return [f"{label}: graphql.field '{field}' không phải bảng trong quyền Hasura của gói"]
    allowed = permission(tables[field], "select_permissions", role)
    if allowed is None:
        return [f"{label}: vai trò '{role}' không đọc được '{field}'; sửa role hoặc quyền của gói"]
    readable = allowed.get("columns", [])
    return [
        f"{label}: vai trò '{role}' không đọc được cột '{column}' của '{field}'"
        for column in columns_of(panel)
        if readable != "*" and column not in readable
    ]


def panel_problems(panel: dict, own: str | None, context: dict) -> list[str]:
    label = f"khối '{panel['id']}'"
    kind = next((name for name in UNSUPPORTED if name in panel), None)
    if kind:
        return [f"{label}: nguồn '{kind}' chưa được thành phần hỗ trợ; dùng graphql"]
    errors = source_problems(panel, label, context["tables"])
    series = [y["column"] for y in (panel.get("chart") or {}).get("y", [])]
    errors += [
        f"{label}: cột '{name}' khai hai lần trong chart.y"
        for name in sorted({n for n in series if series.count(n) > 1})
    ]
    menu = (panel.get("link") or {}).get("menu")
    # Mục của chính trang này dẫn người xem về chỗ đang đứng; mục không có thì đường dẫn không bao giờ hiện.
    if menu and (menu not in context["menu"] or menu == own):
        errors.append(f"{label}: link.menu '{menu}' không phải mục menu khác của gói")
    return errors


def _named(value: object, key: str = "column") -> bool:
    """Danh sách các bảng khóa, mỗi mục có khóa `key` là chữ."""
    return isinstance(value, list) and all(isinstance(i, dict) and isinstance(i.get(key), str) for i in value)


def _source_shape(panel: dict) -> str | None:
    source = panel.get("graphql")
    if not isinstance(source, dict) or not isinstance(source.get("field"), str):
        return "thiếu nguồn: cần graphql: { field: <lược đồ>_<bảng> }"
    where = source.get("where")
    if where is not None and not (isinstance(where, dict) and isinstance(where.get("field"), str)):
        return "graphql.where cần { field, equals }"
    if source.get("order_by") is not None and not _named(source["order_by"]):
        return "graphql.order_by cần là danh sách { column, direction }"
    return None


def _display_shape(panel: dict) -> str | None:
    if ("cards" in panel) == ("chart" in panel):
        return "cần đúng một trong cards, chart"
    if "cards" in panel:
        return None if _named(panel["cards"]) else "cards cần là danh sách { column, label, description }"
    chart = panel["chart"]
    if not (
        isinstance(chart, dict)
        and isinstance(chart.get("x"), dict)
        and isinstance(chart["x"].get("column"), str)
        and _named(chart.get("y"))
        and (chart.get("details") is None or _named(chart["details"]))
    ):
        return "chart cần x: { column, label } và y: [{ column, label, color }]"
    return None


def shape_problem(dashboard: object) -> str | None:
    """Lỗi dạng của những khóa mà bước kiểm đọc tới: cấu hình sai dạng thành một dòng lỗi, không traceback.

    Khi chạy qua scripts/contracts.sh, schema đã kiểm tệp trước; bước này giữ cho lệnh chạy riêng (với
    --dashboard) cũng không văng lỗi Python.
    """
    if (
        not isinstance(dashboard, dict)
        or not isinstance(dashboard.get("panels"), list)
        or not dashboard["panels"]
    ):
        return "cần panels là danh sách khối không rỗng"
    for index, panel in enumerate(dashboard["panels"], 1):
        if not isinstance(panel, dict) or not isinstance(panel.get("id"), str):
            return f"khối thứ {index} thiếu id"
        if any(kind in panel for kind in UNSUPPORTED):
            continue
        problem = _source_shape(panel) or _display_shape(panel)
        link = panel.get("link")
        if (
            not problem
            and link is not None
            and not (isinstance(link, dict) and isinstance(link.get("menu"), str))
        ):
            problem = "link cần { menu, label }"
        if problem:
            return f"khối '{panel['id']}': {problem}"
    return None


def dashboard_problems(dashboard: dict, own: str | None, context: dict) -> list[str]:
    shape = shape_problem(dashboard)
    if shape:
        return [f"{shape}; sửa theo contracts/dashboard.schema.json"]
    ids = [panel["id"] for panel in dashboard["panels"]]
    errors = [f"khối '{name}' được khai hai lần" for name in sorted({n for n in ids if ids.count(n) > 1})]
    for panel in dashboard["panels"]:
        errors += panel_problems(panel, own, context)
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", required=True)
    parser.add_argument("--hasura", nargs="*")
    parser.add_argument("--dashboard")
    args = parser.parse_args()
    directory = os.path.dirname(args.app)
    try:
        app = read_yaml(args.app)
        hasura = os.path.join(directory, app["hasura"]) if app.get("hasura") else None
        context = {
            "tables": tables_of(args.hasura or (sorted(glob.glob(f"{hasura}/*.yaml")) if hasura else [])),
            "menu": {entry["id"] for entry in app.get("menu", [])},
        }
        if args.dashboard:
            dashboards = [(args.dashboard, None)]
        else:
            entries = [e for e in app.get("menu", []) if e["component"] == "dashboard"]
            dashboards = [(os.path.join(directory, e["config"]), e["id"]) for e in entries]
        errors = []
        for path, own in dashboards:
            errors += [f"{path}: {error}" for error in dashboard_problems(read_yaml(path), own, context)]
    except (OSError, ValueError, yaml.YAMLError) as error:
        errors = [f"không đọc được tệp: {error}"]
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
