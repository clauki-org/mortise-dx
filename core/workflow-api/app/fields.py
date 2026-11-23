# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Trường của từng bước người làm, đọc từ BPMN đã deploy (ADR 0031): mỗi userTask khai các biến nó ghi
# bằng `<flowable:formProperty id="..."/>` trong extensionElements. main.py từ chối người lập gửi trường
# của một bước, và người hoàn thành một bước gửi trường của bước khác. Hàm thuần, chỉ dùng thư viện chuẩn,
# không import tương đối: scripts/check-workflow-steps.py nạp tệp này theo đường dẫn, để make check-fast
# đọc trường đúng như workflow-api.

import xml.etree.ElementTree as ET

BPMN = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"
FLOWABLE = "{http://flowable.org/bpmn}"


def step_fields(bpmn: bytes, key: str) -> dict[str, frozenset[str]]:
    """id của userTask -> các trường bước đó ghi, của quy trình `key`; bước không khai trường thì vắng mặt.

    Ném ValueError nếu tệp không đọc được hoặc không có quy trình `key`.
    """
    try:
        # BPMN chỉ vào được Flowable qua bộ cài bằng tài khoản quản trị, như decisions.py.
        root = ET.fromstring(bpmn)  # noqa: S314
    except ET.ParseError as error:
        raise ValueError(f"BPMN sai cú pháp: {error}") from error
    process = next((p for p in root.iter(f"{BPMN}process") if p.get("id") == key), None)
    if process is None:
        raise ValueError(f'không có <process id="{key}">')
    return fields_of(process)


def fields_of(process: ET.Element) -> dict[str, frozenset[str]]:
    """Trường của các userTask trong một <process>, kể cả userTask nằm trong sub-process."""
    found = {}
    for task in process.iter(f"{BPMN}userTask"):
        names = frozenset(prop.get("id", "") for prop in properties(task)) - {""}
        if names:
            found[task.get("id", "")] = names
    return found


def properties(task: ET.Element) -> list[ET.Element]:
    """formProperty khai thẳng trong extensionElements của bước, không lấy của phần tử lồng bên trong."""
    return [
        prop
        for extensions in task.findall(f"{BPMN}extensionElements")
        for prop in extensions.findall(f"{FLOWABLE}formProperty")
    ]
