# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Tìm biến quyết định của một quy trình từ BPMN đã deploy (ADR 0025): tên xuất hiện trong điều kiện rẽ
# nhánh nằm sau một userTask. Hàm thuần, không gọi mạng; flowable.py lấy BPMN từ Flowable rồi gọi hàm ở
# đây, main.py từ chối khởi tạo nếu người lập đặt sẵn một trong các biến này.

import re
import xml.etree.ElementTree as ET

BPMN = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"

# Mọi từ có dạng tên biến trong điều kiện, kể cả trong chuỗi: ${approved}, ${approved == true} và
# ${execution.getVariable("approved")} đều cho ra `approved`. Lấy thừa (execution, getVariable, true) chỉ
# làm người lập không đặt được biến mang các tên đó; lấy thiếu thì người lập đặt sẵn được quyết định, nên
# chọn lấy thừa.
_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def decision_variables(bpmn: bytes, key: str) -> frozenset[str]:
    """Tên dùng trong điều kiện của luồng đi được tới từ một userTask của quy trình `key`.

    Ném ValueError nếu tệp không đọc được hoặc không có quy trình `key`.
    """
    try:
        # BPMN chỉ vào được Flowable qua bộ cài bằng tài khoản quản trị (scripts/app-deploy.py), không do
        # người dùng gửi.
        root = ET.fromstring(bpmn)  # noqa: S314
    except ET.ParseError as error:
        raise ValueError(f"BPMN sai cú pháp: {error}") from error
    process = next((p for p in root.iter(f"{BPMN}process") if p.get("id") == key), None)
    if process is None:
        raise ValueError(f'không có <process id="{key}">')

    outgoing: dict[str, list[ET.Element]] = {}
    for flow in process.iter(f"{BPMN}sequenceFlow"):
        outgoing.setdefault(flow.get("sourceRef", ""), []).append(flow)
    following = _following(process)
    # Đi vào một subProcess thì chạy từ startEvent bên trong nó; ra khỏi nó (sau một nút bên trong) thì chỉ đi
    # luồng ra. Gộp hai việc làm một thì cổng đứng trước bước đầu tiên trong subProcess thành quyết định của
    # chính bước đó.
    starts = {
        sub.get("id", ""): [event.get("id", "") for event in sub.findall(f"{BPMN}startEvent")]
        for sub in process.iter(f"{BPMN}subProcess")
    }

    names: set[str] = set()
    seen: set[tuple[str, bool]] = set()
    # Mỗi phần tử là (nút, có đi vào nút qua sequenceFlow không).
    pending = [(task.get("id", ""), True) for task in process.iter(f"{BPMN}userTask")]
    while pending:
        node, entering = pending.pop()
        if (node, entering) in seen:
            continue
        seen.add((node, entering))
        for flow in outgoing.get(node, []):
            condition = flow.find(f"{BPMN}conditionExpression")
            if condition is not None and condition.text:
                names.update(_NAME.findall(condition.text))
            pending.append((flow.get("targetRef", ""), True))
        if entering:
            pending.extend((start, True) for start in starts.get(node, []))
        pending.extend((after, False) for after in following.get(node, []))
    return frozenset(names)


def _following(process: ET.Element) -> dict[str, list[str]]:
    """Nút chạy tiếp sau một nút mà không nối bằng sequenceFlow.

    Sự kiện biên (hết hạn, lỗi) gắn vào một bước chạy khi bước đó đang chờ; bỏ qua thì nhánh sau sự kiện
    biên của bước duyệt không được xét. Luồng ra của một subProcess chạy sau các nút bên trong nó; bỏ qua
    thì bước duyệt nằm trong subProcess không có nhánh nào sau nó.
    """
    following: dict[str, list[str]] = {}
    for event in process.iter(f"{BPMN}boundaryEvent"):
        following.setdefault(event.get("attachedToRef", ""), []).append(event.get("id", ""))
    for sub in process.iter(f"{BPMN}subProcess"):
        for inner in sub.iter():
            if inner is not sub and inner.get("id"):
                following.setdefault(inner.get("id", ""), []).append(sub.get("id", ""))
    return following
