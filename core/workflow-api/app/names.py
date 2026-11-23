# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Tên các nút người lập thấy trên hồ sơ của mình (ADR 0032), đọc từ BPMN đã deploy: bước người làm (userTask),
# bước chờ (intermediateCatchEvent, ví dụ hẹn giờ công khai) và kết quả (endEvent). flowable.py đọc cùng lần
# với biến quyết định và trường của bước; cases.py lấy tên kết quả và bước chờ từ đây mà không phải hỏi lịch
# sử từng hồ sơ. Hàm thuần, chỉ dùng thư viện chuẩn.

import xml.etree.ElementTree as ET

BPMN = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"

# Loại nút trên hồ sơ theo thẻ BPMN.
KINDS = {"userTask": "task", "intermediateCatchEvent": "wait", "endEvent": "end"}


def node_names(bpmn: bytes, key: str) -> dict[str, tuple[str, str]]:
    """id -> (loại, tên) của các nút trong KINDS của quy trình `key`, kể cả nút trong sub-process.

    Nút không đặt tên thì tên là id. Ném ValueError nếu tệp không đọc được hoặc không có quy trình `key`.
    """
    try:
        # BPMN chỉ vào được Flowable qua bộ cài bằng tài khoản quản trị, như decisions.py.
        root = ET.fromstring(bpmn)  # noqa: S314
    except ET.ParseError as error:
        raise ValueError(f"BPMN sai cú pháp: {error}") from error
    process = next((p for p in root.iter(f"{BPMN}process") if p.get("id") == key), None)
    if process is None:
        raise ValueError(f'không có <process id="{key}">')
    found = {}
    for tag, kind in KINDS.items():
        for node in process.iter(f"{BPMN}{tag}"):
            node_id = node.get("id", "")
            found[node_id] = (kind, node.get("name") or node_id)
    return found
