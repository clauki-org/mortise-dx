# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm cấu hình thành phần trang (contracts/page.schema.json) với gói chứa nó, luật JSON Schema không diễn đạt
# được (ADR 0061): mỗi khối trỏ tới một mục có thật trong menu hay blocks của chính gói, không trỏ tới một
# trang (trang lồng trang có thể tự chứa mình, vẽ không bao giờ xong), và kiểu của khối là một giá trị trong
# variant của schema thành phần mà mục đó dùng. Thiếu bước này, khối có id gõ sai lặng lẽ biến khỏi trang mà
# không ai biết vì sao. Gọi từ scripts/contracts.sh: --app <app.yaml> [--page <tệp cấu hình trang>].

import argparse
import json
import os
import sys

import yaml
from app_entries import entries

CONTRACTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "contracts")


def variants_of(component: str) -> list[str]:
    """Kiểu của một thành phần, đọc từ chính schema của nó; chưa khai variant thì không có kiểu nào."""
    path = os.path.join(CONTRACTS, f"{component}.schema.json")
    if not os.path.isfile(path):
        return []
    with open(path, encoding="utf-8") as file:
        schema = json.load(file)
    return list(schema.get("properties", {}).get("variant", {}).get("enum", []))


def page_problems(page: dict, items: dict[str, str]) -> list[str]:
    errors = []
    for index, block in enumerate(page.get("blocks", []), start=1):
        name = block.get("item")
        component = items.get(name)
        if component is None:
            errors.append(f"khối {index}: không có mục '{name}' trong menu hay blocks của gói")
            continue
        if component == "page":
            errors.append(f"khối {index}: mục '{name}' là một trang; trang không chứa trang")
            continue
        variant = block.get("variant")
        allowed = variants_of(component)
        if variant is not None and variant not in allowed:
            choice = ", ".join(allowed) if allowed else "thành phần này chưa có kiểu nào, bỏ variant"
            errors.append(f"khối {index}: {component} không có kiểu '{variant}' ({choice})")
    return errors


def read_yaml(path: str) -> dict:
    with open(path, encoding="utf-8") as file:
        return yaml.safe_load(file)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", required=True)
    parser.add_argument("--page")
    args = parser.parse_args()
    directory = os.path.dirname(args.app)
    try:
        app = read_yaml(args.app)
        items = {entry["id"]: entry["component"] for entry in entries(app)}
        if args.page:
            pages = [args.page]
        else:
            pages = [os.path.join(directory, e["config"]) for e in entries(app) if e["component"] == "page"]
        errors = []
        for path in pages:
            errors += [f"{path}: {error}" for error in page_problems(read_yaml(path), items)]
    except (OSError, ValueError, KeyError, TypeError, AttributeError, yaml.YAMLError) as error:
        errors = [f"không đọc được tệp: {error}"]
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
