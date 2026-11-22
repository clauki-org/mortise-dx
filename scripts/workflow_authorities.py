# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm bảng phân cấp thẩm quyền khớp BPMN (ADR 0028), cho scripts/check-workflow-steps.py (make check-fast).
# candidateGroups và candidateUsers của một userTask chỉ được là danh sách vai trò viết sẵn hoặc đúng
# `${authority_<id của userTask>}`: biểu thức khác thì workflow-api không biết bước nào đọc bảng, hoặc đọc
# nhầm dòng của bước khác. Bước nào đọc bảng thì gói (mục `authorities` của app.yaml) hay lõi (--authorities)
# phải khai dòng gốc cho nó, nếu không mọi hồ sơ của quy trình bị workflow-api từ chối (409) ngay sau khi cài.

import os
import re
import xml.etree.ElementTree as ET

import yaml

BPMN = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"
FLOWABLE = "{http://flowable.org/bpmn}"
CANDIDATES = ("candidateGroups", "candidateUsers")
# Cùng luật vai trò với cột role của core.step_authorities, nối bằng dấu phẩy như Flowable đọc.
ROLE = r"[a-z][a-z0-9_]*(-[a-z0-9_]+)*"
LITERAL = re.compile(f"{ROLE}(,{ROLE})*")
# Biểu thức UEL đọc `${authority_review-report}` thành phép trừ, nên id của bước đọc bảng phải là định danh.
IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def owner(path: str) -> str:
    """Gói chứa tệp (apps/<gói>), hay `core` cho tệp của lõi."""
    parts = os.path.normpath(path).split(os.sep)
    return os.path.join("apps", parts[1]) if len(parts) > 2 and parts[0] == "apps" else "core"


def uses(path: str, root: ET.Element) -> tuple[set[tuple[str, str]], list[str]]:
    """(quy trình, bước) đọc bảng trong một tệp BPMN, và lỗi của candidate* không đúng một trong hai dạng."""
    found, errors = set(), []
    for process in root.iter(f"{BPMN}process"):
        for task in process.iter(f"{BPMN}userTask"):
            step = task.get("id", "")
            for attribute in CANDIDATES:
                value = task.get(f"{FLOWABLE}{attribute}")
                if value is None or LITERAL.fullmatch(value):
                    continue
                if value == f"${{authority_{step}}}" and IDENTIFIER.fullmatch(step):
                    found.add((process.get("id", ""), step))
                    continue
                errors.append(
                    f"{path}: userTask '{step}' có {attribute}=\"{value}\"; chỉ dùng danh sách vai trò chữ "
                    f"thường cách nhau dấu phẩy, hoặc đúng ${{authority_{step}}} với id của bước là định "
                    "danh (chữ, số, _)"
                )
    return found, errors


def tables(path: str) -> tuple[tuple[str, str], list[str]]:
    """(quy trình, bước) mà một tệp bảng phân cấp khai, và lỗi schema không diễn đạt được."""
    try:
        with open(path, encoding="utf-8") as file:
            table = yaml.safe_load(file)
        key, rows = (table["process"], table["step"]), table["rows"]
        rules = [row["rule"] for row in rows]
    except (OSError, yaml.YAMLError, KeyError, TypeError) as error:
        return ("", ""), [f"{path}: không đọc được ({error}); kiểm theo contracts/authority.schema.json"]
    errors = [
        f"{path}: mã dòng '{rule}' bị trùng" for rule in sorted({r for r in rules if rules.count(r) > 1})
    ]
    if not any("above" not in row for row in rows):
        errors.append(f"{path}: thiếu dòng gốc (dòng không có above)")
    return key, errors


def declared(owners: set[str], core_files: list[str]) -> dict[str, list[str]]:
    files = {"core": list(core_files)} if "core" in owners else {}
    for name in sorted(owners - {"core"}):
        with open(os.path.join(name, "app.yaml"), encoding="utf-8") as file:
            listed = yaml.safe_load(file).get("authorities") or []
        files[name] = [os.path.join(name, path) for path in listed]
    return files


def problems(bpmn: dict[str, ET.Element], core_files: list[str]) -> list[str]:
    """Lỗi của mọi BPMN đã đọc (đường dẫn -> gốc XML) so với bảng phân cấp của gói chứa nó."""
    errors: list[str] = []
    used: dict[str, set[tuple[str, str]]] = {}
    for path, root in bpmn.items():
        found, wrong = uses(path, root)
        used.setdefault(owner(path), set()).update(found)
        errors += wrong
    for name, files in declared(set(used), core_files).items():
        seen: dict[tuple[str, str], str] = {}
        for path in files:
            key, wrong = tables(path)
            errors += wrong
            if not key[0]:
                continue
            if key in seen:
                errors.append(f"{path}: bước '{key[1]}' của '{key[0]}' đã khai ở {seen[key]}")
            elif key not in used[name]:
                errors.append(
                    f"{path}: BPMN của {name} không có userTask '{key[1]}' của '{key[0]}' với "
                    f"candidateGroups ${{authority_{key[1]}}}"
                )
            seen[key] = path
        for process, step in sorted(used[name] - seen.keys()):
            where = (
                "--authorities của scripts/contracts.sh" if name == "core" else "`authorities` của app.yaml"
            )
            errors.append(
                f"{name}: userTask '{step}' của '{process}' đọc bảng phân cấp mà chưa có tệp khai dòng gốc; "
                f"thêm tệp theo contracts/authority.schema.json vào {where}"
            )
    return errors
