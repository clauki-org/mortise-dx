# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm cấu hình thành phần theo dõi hồ sơ (contracts/cases.schema.json) với gói chứa nó, luật JSON Schema
# không diễn đạt được: mỗi quy trình trong `processes` có trong BPMN của chính gói đó (ADR 0032). Thiếu bước
# này, khóa gõ sai hay khóa của gói khác chỉ làm trang luôn trống mà không ai biết vì sao. Gọi từ
# scripts/contracts.sh: --bpmn <tệp BPMN của gói...> --cases <tệp cấu hình theo dõi hồ sơ...>.

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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bpmn", nargs="*", default=[], required=True)
    parser.add_argument("--cases", nargs="*", default=[], required=True)
    args = parser.parse_args()
    try:
        keys = process_keys(args.bpmn)
        errors = []
        for path in args.cases:
            with open(path, encoding="utf-8") as file:
                config = yaml.safe_load(file)
            errors += [
                f"{path}: quy trình '{key}' không có trong BPMN của gói; sửa khóa hoặc thêm quy trình "
                "vào workflows"
                for key in config["processes"]
                if key not in keys
            ]
    except (ET.ParseError, OSError, yaml.YAMLError) as error:
        errors = [f"không đọc được tệp: {error}"]
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
