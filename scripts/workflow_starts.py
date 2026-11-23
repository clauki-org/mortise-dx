# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm biến khởi tạo viết sẵn không trùng trường của một bước (ADR 0031), cho
# scripts/check-workflow-steps.py (make check-fast). workflow-api từ chối người lập gửi trường của bất kỳ bước
# nào, kể cả khi người lập là máy: iot-bridge mở hồ sơ của luật ngưỡng với một bộ biến cố định, nút của danh
# mục với biến khai trong cấu hình. Trùng tên thì mọi lần mở đều nhận 400: hồ sơ cảnh báo không mở mà chỉ để
# lại một dòng nhật ký của iot-bridge, nút danh mục báo lỗi mỗi lần bấm. Luật và danh mục của gói đọc từ
# app.yaml (mục `rules`, `menu`); của lõi hay của ví dụ sai truyền thẳng.

import importlib.util
import os
import xml.etree.ElementTree as ET

import yaml
from workflow_fields import fields_api

BPMN = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _case_variables() -> tuple[str, ...]:
    """Biến iot-bridge gửi khi mở hồ sơ, lấy từ chính mã của nó để danh sách chỉ nằm một chỗ.

    Nạp theo đường dẫn tệp: rules.py chỉ dùng thư viện chuẩn, còn nhập cả gói app thì phải có cấu hình của
    dịch vụ.
    """
    path = os.path.join(REPO, "core", "iot-bridge", "app", "rules.py")
    spec = importlib.util.spec_from_file_location("iot_bridge_rules", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.CASE_VARIABLES


CASE_VARIABLES = _case_variables()


def _load(path: str):
    with open(path, encoding="utf-8") as file:
        return yaml.safe_load(file)


def package_files(packages: list[str]) -> tuple[list[str], list[str]]:
    """(tệp luật, tệp cấu hình danh mục) mà app.yaml của các gói khai."""
    rules, catalogs = [], []
    for package in packages:
        app = _load(os.path.join(package, "app.yaml"))
        rules += [os.path.join(package, path) for path in app.get("rules", [])]
        catalogs += [
            os.path.join(package, item["config"])
            for item in app.get("menu", [])
            if item["component"] == "catalog"
        ]
    return rules, catalogs


def _actions(node: dict) -> list[dict]:
    detail = node.get("detail") or {}
    found = list(detail.get("actions", []))
    for child in detail.get("children", []):
        found += _actions(child)
    return found


def problems(
    roots: dict[str, ET.Element], rules: list[str], catalogs: list[str], packages: list[str]
) -> list[str]:
    fields = {}
    for path, root in roots.items():
        for process in root.iter(f"{BPMN}process"):
            fields[process.get("id")] = (path, fields_api.fields_of(process))
    more_rules, more_catalogs = package_files(packages)
    starts = [
        (path, f"luật '{rule['id']}'", "iot-bridge gửi", rule["process"], CASE_VARIABLES)
        for path in rules + more_rules
        for rule in [_load(path)]
    ]
    starts += [
        (path, f"nút '{action['id']}'", "nút gửi", action["process"], tuple(action["variables"]))
        for path in catalogs + more_catalogs
        for action in _actions(_load(path))
    ]
    errors = []
    for path, who, sends, process, names in starts:
        # Quy trình không có trong các BPMN đang kiểm thì lần chạy khác (cả lõi và mọi gói) kiểm.
        bpmn, steps = fields.get(process, ("", {}))
        for name in names:
            for step in sorted(step for step, owned in steps.items() if name in owned):
                errors.append(
                    f"{path}: {who} mở quy trình '{process}', {sends} biến '{name}' trùng trường của bước "
                    f"'{step}' ({bpmn}); workflow-api từ chối mọi lần mở (ADR 0031)"
                )
    return errors
