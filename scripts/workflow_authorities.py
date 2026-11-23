# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm bảng phân cấp thẩm quyền khớp BPMN (ADR 0028), cho scripts/check-workflow-steps.py (make check-fast).
# candidateGroups của một userTask chỉ được là danh sách vai trò viết sẵn hoặc đúng `${authority_<id của
# userTask>}`; candidateUsers chỉ được viết sẵn. Biểu thức khác thì workflow-api không biết bước nào đọc bảng,
# hoặc đọc nhầm dòng của bước khác. Bước nào đọc bảng thì gói (mục `authorities` của app.yaml) hay lõi
# (--authorities) phải khai dòng gốc cho nó, nếu không mọi hồ sơ của quy trình bị workflow-api từ chối (409)
# ngay sau khi cài. Mọi tệp bảng khai trong app.yaml đều được kiểm, kể cả khi BPMN của gói không dùng bảng.

import importlib.util
import os
import re
import xml.etree.ElementTree as ET

import yaml

BPMN = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"
FLOWABLE = "{http://flowable.org/bpmn}"
GROUPS, USERS = "candidateGroups", "candidateUsers"
# Cùng luật vai trò với cột role của core.step_authorities, nối bằng dấu phẩy như Flowable đọc. Tiền tố
# authority_ là của biến lõi đặt, không phải vai trò.
ROLE = r"(?!authority_)[a-z][a-z0-9_]*(-[a-z0-9_]+)*"
LITERAL = re.compile(f"{ROLE}(,{ROLE})*")
# Biểu thức UEL đọc `${authority_review-report}` thành phép trừ, nên id của bước đọc bảng phải là định danh.
IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _decisions():
    """Hàm tìm biến quyết định của chính workflow-api (ADR 0025), để kiểm ở đây khớp điều workflow-api từ
    chối.

    Nạp theo đường dẫn tệp: decisions.py chỉ dùng thư viện chuẩn, còn nhập cả gói app thì phải có cấu hình của
    dịch vụ.
    """
    path = os.path.join(REPO, "core", "workflow-api", "app", "decisions.py")
    spec = importlib.util.spec_from_file_location("workflow_decisions", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.decision_variables


decision_variables = _decisions()


def owner(path: str) -> str:
    """Gói chứa tệp (apps/<gói>), hay `core` cho tệp của lõi."""
    parts = os.path.normpath(path).split(os.sep)
    return os.path.join("apps", parts[1]) if len(parts) > 2 and parts[0] == "apps" else "core"


def uses(path: str, root: ET.Element) -> tuple[set[tuple[str, str]], list[str]]:
    """(quy trình, bước) đọc bảng trong một tệp BPMN, và lỗi của candidate* không đúng dạng cho phép."""
    found, errors = set(), []
    for process in root.iter(f"{BPMN}process"):
        for task in process.iter(f"{BPMN}userTask"):
            step = task.get("id", "")
            for attribute in (GROUPS, USERS):
                value = task.get(f"{FLOWABLE}{attribute}")
                if value is None or LITERAL.fullmatch(value):
                    continue
                if attribute == GROUPS and value == f"${{authority_{step}}}" and IDENTIFIER.fullmatch(step):
                    found.add((process.get("id", ""), step))
                    continue
                allowed = f"hoặc đúng ${{authority_{step}}} với id của bước là định danh (chữ, số, _)"
                errors.append(
                    f"{path}: userTask '{step}' có {attribute}=\"{value}\"; chỉ dùng danh sách vai trò chữ "
                    "thường cách nhau dấu phẩy, không bắt đầu bằng authority_"
                    + (
                        f", {allowed}"
                        if attribute == GROUPS
                        else "; bảng phân cấp chỉ dùng ở candidateGroups"
                    )
                )
    return found, errors


def tables(path: str) -> tuple[tuple[str, str], set[str], list[str]]:
    """(quy trình, bước) mà một tệp bảng phân cấp khai, biến của các dòng ngưỡng, và lỗi schema không diễn đạt
    được."""
    try:
        with open(path, encoding="utf-8") as file:
            table = yaml.safe_load(file)
        key, rows = (table["process"], table["step"]), table["rows"]
        rules = [row["rule"] for row in rows]
        variables = {row["variable"] for row in rows if "variable" in row}
    except (OSError, yaml.YAMLError, KeyError, TypeError) as error:
        return (
            ("", ""),
            set(),
            [f"{path}: không đọc được ({error}); kiểm theo contracts/authority.schema.json"],
        )
    errors = [
        f"{path}: mã dòng '{rule}' bị trùng" for rule in sorted({r for r in rules if rules.count(r) > 1})
    ]
    if not any("above" not in row for row in rows):
        errors.append(f"{path}: thiếu dòng gốc (dòng không có above)")
    return key, variables, errors


def declared(owners: set[str], core_files: list[str]) -> dict[str, list[str]]:
    files = {"core": list(core_files)} if "core" in owners else {}
    for name in sorted(owners - {"core"}):
        with open(os.path.join(name, "app.yaml"), encoding="utf-8") as file:
            listed = yaml.safe_load(file).get("authorities") or []
        files[name] = [os.path.join(name, path) for path in listed]
    return files


def decision_problems(
    path: str, key: tuple[str, str], variables: set[str], bpmn: dict[str, bytes]
) -> list[str]:
    # Người lập không gửi được biến quyết định (ADR 0025), nên dòng ngưỡng so với nó luôn thấy biến thiếu và
    # mọi hồ sơ đi dòng nghiêm nhất.
    if key[0] not in bpmn:
        return []
    clash = sorted(variables & decision_variables(bpmn[key[0]], key[0]))
    return [
        f"{path}: dòng ngưỡng so biến {name}, là biến quyết định của '{key[0]}' (ADR 0025): người lập không "
        "gửi được nên mọi hồ sơ đi dòng nghiêm nhất; dùng biến người lập gửi lúc khởi tạo"
        for name in clash
    ]


def problems(bpmn: dict[str, ET.Element], core_files: list[str], packages: list[str] = ()) -> list[str]:
    """Lỗi của mọi BPMN đã đọc (đường dẫn -> gốc XML) so với bảng phân cấp của gói chứa nó, và của mọi tệp
    bảng của các gói trong `packages` (thư mục gói), kể cả gói không có BPMN."""
    errors: list[str] = []
    used: dict[str, set[tuple[str, str]]] = {owner(package + "/app.yaml"): set() for package in packages}
    sources: dict[str, dict[str, bytes]] = {}
    for path, root in bpmn.items():
        found, wrong = uses(path, root)
        used.setdefault(owner(path), set()).update(found)
        content = ET.tostring(root)
        for process in root.iter(f"{BPMN}process"):
            sources.setdefault(owner(path), {})[process.get("id", "")] = content
        errors += wrong
    for name, files in declared(set(used), core_files).items():
        seen: dict[tuple[str, str], str] = {}
        for path in files:
            key, variables, wrong = tables(path)
            errors += wrong
            if not key[0]:
                continue
            errors += decision_problems(path, key, variables, sources.get(name, {}))
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
