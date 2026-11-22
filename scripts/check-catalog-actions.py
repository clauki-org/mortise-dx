# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm nút của cấu hình danh mục (detail.actions, contracts/catalog.schema.json) với gói chứa nó, những
# luật JSON Schema không diễn đạt được: quy trình của nút có trong BPMN của cùng gói, và mỗi biến lấy giá
# trị từ khóa hay từ một trường đã khai của loại đối tượng có nút (ADR 0026). Thiếu bước này, lỗi chỉ lộ
# ra khi người dùng bấm nút: workflow-api trả 404 vì tenant không có quy trình, hay giá trị biến trống.
# Thành phần danh mục kiểm lại luật thứ hai lúc chạy. Gọi từ scripts/contracts.sh:
# --bpmn <tệp BPMN của gói...> --catalog <tệp cấu hình danh mục...>.

import argparse
import sys
import xml.etree.ElementTree as ET

import yaml

BPMN = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"


def process_keys(bpmn_files: list[str]) -> set[str]:
    keys = set()
    for path in bpmn_files:
        # Tệp BPMN nằm trong repo, do người đóng góp viết, không phải dữ liệu từ bên ngoài.
        root = ET.parse(path).getroot()  # noqa: S314
        keys |= {process.get("id") for process in root.iter(f"{BPMN}process")}
    return keys


def node_problems(path: str, node: dict, keys: set[str], where: str) -> list[str]:
    errors = []
    detail = node.get("detail") or {}
    names = {field["name"] for field in node["fields"]} | {node.get("key", "id")}
    for action in detail.get("actions", []):
        label = f"{path}: {where}nút '{action['id']}'"
        if action["process"] not in keys:
            errors.append(f"{label} mở quy trình '{action['process']}' mà BPMN của gói không có")
        for variable, source in action["variables"].items():
            if source not in names:
                errors.append(
                    f"{label} lấy biến '{variable}' từ '{source}', không phải khóa hay trường đã khai"
                )
    for child in detail.get("children", []):
        errors += node_problems(path, child, keys, f"{where}{child['id']}: ")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bpmn", nargs="*", default=[], required=True)
    parser.add_argument("--catalog", nargs="*", default=[], required=True)
    args = parser.parse_args()
    try:
        keys = process_keys(args.bpmn)
        errors = []
        for path in args.catalog:
            with open(path, encoding="utf-8") as file:
                errors += node_problems(path, yaml.safe_load(file), keys, "")
    except (ET.ParseError, OSError, yaml.YAMLError) as error:
        errors = [f"không đọc được tệp: {error}"]
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
