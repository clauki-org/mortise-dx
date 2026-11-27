# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Luật nhiều tệp của app.yaml mà contracts/app.schema.json không diễn đạt được: id trùng tên thư mục,
# id menu không trùng, mọi tệp app.yaml trỏ tới có thật, và văn bản cho trợ lý (scripts/app_knowledge.py)
# đúng mã. Chạy ngay sau schema của app.yaml trong `scripts/contracts.sh package <gói>`, trước các bước
# khác: tệp thiếu làm check-jsonschema và các bộ kiểm khác dừng bằng traceback thay vì một dòng lỗi. Không
# gọi CSDL hay mạng, nên bộ cài (scripts/app.sh) chạy được trước khi đụng CSDL. --configs đổi thư mục đọc
# tệp cấu hình của mục menu, như ở scripts/contracts.sh.

import argparse
import os
import sys

import app_knowledge
import yaml

# Mục của app.yaml chứa danh sách đường dẫn tương đối tới thư mục gói.
PATH_LISTS = ("workflows", "rules", "knowledge", "authorities")


def read_yaml(path: str) -> dict:
    with open(path, encoding="utf-8") as file:
        return yaml.safe_load(file) or {}


def missing_files(directory: str, configs: str, app: dict) -> list[str]:
    found = []
    for name in PATH_LISTS:
        for index, path in enumerate(app.get(name, [])):
            if not os.path.isfile(os.path.join(directory, path)):
                found.append(f"{name}[{index}]: tệp {path} không có trong {directory}")
    for index, entry in enumerate(app.get("menu", [])):
        if not os.path.isfile(os.path.join(configs, entry["config"])):
            found.append(f"menu[{index}].config: tệp {entry['config']} không có trong {configs}")
    return found


def problems(path: str, configs: str | None) -> list[str]:
    directory = os.path.dirname(path)
    configs = configs or directory
    app = read_yaml(path)
    found = []
    # Bảng theo dõi migration đặt theo tên thư mục (scripts/app.sh), nên lệch nhau là hai bản cài của cùng
    # một gói có hai lịch sử migration.
    name = os.path.basename(os.path.normpath(directory))
    if app.get("id") != name:
        found.append(f"id '{app.get('id')}' phải trùng tên thư mục '{name}'")
    # Trùng id làm câu INSERT của bộ cài báo lỗi khó hiểu sau khi quy trình đã deploy.
    ids = [entry["id"] for entry in app.get("menu", [])]
    if len(ids) != len(set(ids)):
        found.append(f"id trong menu bị trùng ({', '.join(sorted(ids))})")
    missing = missing_files(directory, configs, app)
    if missing:
        # Luật văn bản dưới đây đọc các tệp đó; thiếu một tệp thì chỉ báo thiếu.
        return found + missing
    documents = [read_yaml(os.path.join(directory, p)) for p in app.get("knowledge", [])]
    found += [f"knowledge: {problem}" for problem in app_knowledge.problems(documents)]
    found += app_knowledge.menu_problems(configs, app, {document["id"] for document in documents})
    return found


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", required=True)
    parser.add_argument("--configs")
    args = parser.parse_args()
    try:
        errors = [f"{args.app}: {problem}" for problem in problems(args.app, args.configs)]
    except (OSError, KeyError, TypeError, yaml.YAMLError) as error:
        errors = [f"{args.app}: không đọc được tệp: {error}"]
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
