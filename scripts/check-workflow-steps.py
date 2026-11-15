# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm khai báo bước (contracts/workflow.schema.json) khớp với BPMN và với chính nó, những luật JSON
# Schema không diễn đạt được: mỗi quy trình có bước người làm thì có đúng một tệp khai báo, mỗi userTask
# có khai báo, không khai bước mà BPMN không có, `id` nút không trùng trong một bước, trường bắt buộc của
# biểu mẫu có trong biểu mẫu. Thiếu bước này, task của bước quên khai báo hiện ra trên bảng việc mà không
# có nút để xử lý. Gọi từ scripts/contracts.sh: --bpmn <tệp BPMN...> --steps <tệp khai báo...>.

import argparse
import sys
import xml.etree.ElementTree as ET

import yaml

BPMN = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"


class Unreadable(Exception):
    pass


def user_tasks(bpmn_files: list[str]) -> tuple[dict[str, set[str]], list[str]]:
    """Khóa quy trình -> id các userTask, chỉ với quy trình có ít nhất một userTask."""
    found: dict[str, set[str]] = {}
    where: dict[str, str] = {}
    errors = []
    for path in bpmn_files:
        try:
            # Tệp BPMN nằm trong repo, do người đóng góp viết, không phải dữ liệu từ bên ngoài.
            root = ET.parse(path).getroot()  # noqa: S314
        except (ET.ParseError, OSError) as error:
            raise Unreadable(f"{path}: không đọc được BPMN ({error})") from error
        for process in root.iter(f"{BPMN}process"):
            key = process.get("id")
            if not key:
                errors.append(f"{path}: có phần tử <process> không có id")
                continue
            # Flowable chỉ giữ một định nghĩa cho mỗi khóa, nên hai tệp cùng khóa là lỗi, không phải hai nửa.
            if key in where:
                errors.append(f"{path}: quy trình '{key}' đã có ở {where[key]}")
                continue
            where[key] = path
            tasks = {task.get("id") for task in process.iter(f"{BPMN}userTask")}
            if tasks:
                found[key] = tasks
    return found, errors


def read_declaration(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as file:
            declared = yaml.safe_load(file)
    except (yaml.YAMLError, OSError) as error:
        raise Unreadable(f"{path}: không đọc được YAML ({error})") from error
    if not isinstance(declared, dict) or "process" not in declared or "steps" not in declared:
        raise Unreadable(f"{path}: không phải khai báo bước; kiểm lại theo contracts/workflow.schema.json")
    return declared


def step_problems(path: str, name: str, step: dict) -> list[str]:
    errors = []
    ids = [action["id"] for action in step["actions"]]
    for duplicate in sorted({i for i in ids if ids.count(i) > 1}):
        errors.append(f"{path}: bước '{name}' có hai nút cùng id '{duplicate}'")
    form = step.get("form", {})
    for field in sorted(set(form.get("required", [])) - set(form.get("properties", {}))):
        errors.append(f"{path}: bước '{name}' bắt buộc trường '{field}' mà biểu mẫu không có")
    return errors


def problems(processes: dict[str, set[str]], declarations: list[str]) -> list[str]:
    errors = []
    seen: dict[str, str] = {}
    for path in declarations:
        declared = read_declaration(path)
        process, steps = declared["process"], declared["steps"]
        for name, step in steps.items():
            errors += step_problems(path, name, step)
        if process in seen:
            errors.append(f"{path}: quy trình '{process}' đã khai ở {seen[process]}")
            continue
        seen[process] = path
        if process not in processes:
            errors.append(f"{path}: không có BPMN nào chứa quy trình '{process}' có bước người làm")
            continue
        for name in sorted(processes[process] - steps.keys()):
            errors.append(f"{path}: thiếu khai báo cho userTask '{name}'")
        for name in sorted(steps.keys() - processes[process]):
            errors.append(f"{path}: khai bước '{name}' mà quy trình '{process}' không có")
    for process in sorted(processes.keys() - seen.keys()):
        errors.append(f"quy trình '{process}' có bước người làm nhưng chưa có tệp khai báo bước")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bpmn", nargs="*", default=[], required=True)
    parser.add_argument("--steps", nargs="*", default=[], required=True)
    args = parser.parse_args()
    try:
        processes, errors = user_tasks(args.bpmn)
        errors += problems(processes, args.steps)
    except Unreadable as error:
        errors = [str(error)]
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
