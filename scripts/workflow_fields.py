# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm trường của từng bước khớp giữa BPMN và khai báo bước (ADR 0031), cho scripts/check-workflow-steps.py
# (make check-fast). workflow-api chỉ biết trường của một bước qua `<flowable:formProperty id="..."/>` của
# userTask; bảng việc gửi trường của `form.properties` và `variables` của nút. Khai báo bước ghi một trường mà
# BPMN không khai thì người lập và người làm bước khác ghi được trường đó; BPMN khai mà khai báo bước không có
# thì người làm bước bị chặn ở chính trường của bước khác dùng chung tên mà không biết vì sao.

import importlib.util
import os
import xml.etree.ElementTree as ET

BPMN = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"
FLOWABLE = "{http://flowable.org/bpmn}"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _fields_module():
    """Cách đọc trường của chính workflow-api, để kiểm ở đây khớp điều workflow-api từ chối.

    Nạp theo đường dẫn tệp như workflow_authorities.py nạp decisions.py: fields.py chỉ dùng thư viện chuẩn.
    """
    path = os.path.join(REPO, "core", "workflow-api", "app", "fields.py")
    spec = importlib.util.spec_from_file_location("workflow_fields_api", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fields_api = _fields_module()


def declared_fields(step: dict) -> set[str]:
    """Biến bảng việc gửi khi hoàn thành bước: trường của biểu mẫu và biến của mọi nút."""
    names = set((step.get("form") or {}).get("properties") or {})
    for action in step["actions"]:
        names |= set(action.get("variables") or {})
    return names


def shape_problems(path: str, process: ET.Element) -> list[str]:
    """formProperty chỉ được là `<flowable:formProperty id="..."/>` thẳng dưới userTask.

    Thuộc tính khác (type, required, variable, expression) chỉ có tác dụng qua FormService của Flowable, mà
    workflow-api hoàn thành task bằng TaskService: chúng hứa điều không xảy ra, `variable` làm tên biến khác
    id mà workflow-api đọc, và `expression` là biểu thức chạy trong Flowable, thứ gói khai báo không được có
    (ADR 0022). formProperty ở nút khác userTask thì workflow-api không đọc.
    """
    errors = []
    # Hai userTask cùng id thì một bước mất trường của bước kia; Flowable cũng từ chối deploy, nhưng muộn hơn.
    ids = [task.get("id") for task in process.iter(f"{BPMN}userTask")]
    for duplicate in sorted({i for i in ids if i and ids.count(i) > 1}):
        errors.append(f"{path}: quy trình '{process.get('id')}' có hai userTask cùng id '{duplicate}'")
    owned = set()
    for task in process.iter(f"{BPMN}userTask"):
        ids = []
        for prop in fields_api.properties(task):
            owned.add(prop)
            label = f"{path}: userTask '{task.get('id')}' có formProperty '{prop.get('id', '')}'"
            if not prop.get("id"):
                errors.append(f"{path}: userTask '{task.get('id')}' có formProperty không có id")
            if set(prop.attrib) - {"id"} or len(prop):
                errors.append(f"{label} kèm thuộc tính hay phần tử con; chỉ khai id (ADR 0031)")
            ids.append(prop.get("id"))
        for duplicate in sorted({i for i in ids if i and ids.count(i) > 1}):
            errors.append(f"{path}: userTask '{task.get('id')}' khai formProperty '{duplicate}' hai lần")
    for prop in process.iter(f"{FLOWABLE}formProperty"):
        if prop not in owned:
            errors.append(
                f"{path}: formProperty '{prop.get('id', '')}' không nằm trong extensionElements của một "
                "userTask; workflow-api chỉ đọc trường của userTask (ADR 0031)"
            )
    return errors


def problems(roots: dict[str, ET.Element], declared: dict[str, tuple[str, dict]]) -> list[str]:
    """Lỗi hình dạng formProperty, và trường lệch giữa BPMN và khai báo bước.

    `declared`: khóa quy trình -> (tệp khai báo, các bước của nó).
    """
    errors = []
    for path, root in roots.items():
        for process in root.iter(f"{BPMN}process"):
            errors += shape_problems(path, process)
            if process.get("id") in declared:
                errors += match_problems(path, process, *declared[process.get("id")])
    return errors


def match_problems(path: str, process: ET.Element, where: str, steps: dict) -> list[str]:
    errors = []
    in_bpmn = fields_api.fields_of(process)
    # Bước không có trong BPMN đã được check-workflow-steps.py báo; ở đây chỉ so bước có thật.
    tasks = {task.get("id") for task in process.iter(f"{BPMN}userTask")}
    for name in sorted(steps.keys() & tasks):
        have, want = set(in_bpmn.get(name, ())), declared_fields(steps[name])
        errors += [
            f"{where}: bước '{name}' gửi '{field}' (form hay nút) mà userTask '{name}' trong {path} "
            f'chưa khai <flowable:formProperty id="{field}"/>; thiếu thì người lập và người làm bước khác '
            "ghi được trường này (ADR 0031)"
            for field in sorted(want - have)
        ]
        errors += [
            f"{path}: userTask '{name}' khai formProperty '{field}' mà bước '{name}' trong {where} không có "
            "trong form hay variables của nút nào"
            for field in sorted(have - want)
        ]
    return errors
