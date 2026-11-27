# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Niêm phong hồ sơ (ADR 0053): quy trình khai `mortise:seal="true"` trên <process> thì khi kết thúc,
# workflow-api băm bản JSON chuẩn của hồ sơ (trường của các bước, lịch sử bước, kết quả) và ghi băm vào
# core.case_seals. Tệp này chỉ gồm hàm thuần, chỉ dùng thư viện chuẩn, không import tương đối: sealing.py dùng
# lúc niêm phong, seal_verify.py dùng lúc kiểm, và scripts/check-workflow-steps.py nạp theo đường dẫn để make
# check-fast đọc cờ đúng như workflow-api. Hai lúc băm phải dùng cùng một hàm, nếu không thì hồ sơ nguyên vẹn
# cũng báo lệch.

import hashlib
import json
import xml.etree.ElementTree as ET
from collections.abc import Iterable
from datetime import datetime

BPMN = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"
# Không gian tên riêng của Mortise: thuộc tính lạ của không gian tên khác được XSD của BPMN cho qua
# (anyAttribute), Flowable deploy được và trả nguyên trong resourcedata (đã thử trên flowable-rest 7.2.0).
# Dùng tiền tố flowable: thì người đọc tưởng đó là tính năng của Flowable.
MORTISE = "https://mortise-dx/bpmn"
SEAL_ATTRIBUTE = f"{{{MORTISE}}}seal"
# Đổi cách dựng bản JSON thì tăng số này và giữ cách cũ cho các băm cũ; không sửa phiên bản đã dùng.
VERSION = 1


def seal_flag(process: ET.Element) -> bool:
    """Quy trình có khai niêm phong không. Ném ValueError nếu giá trị không phải true hay false."""
    value = process.get(SEAL_ATTRIBUTE)
    if value is None or value == "false":
        return False
    if value == "true":
        return True
    raise ValueError(
        f'mortise:seal của quy trình "{process.get("id")}" là "{value}", chỉ nhận true hoặc false'
    )


def seal_of(bpmn: bytes, key: str) -> bool:
    """Cờ niêm phong của quy trình `key` trong BPMN đã deploy. Ném ValueError như seal_flag, hay khi không đọc
    được tệp."""
    try:
        # BPMN chỉ vào được Flowable qua bộ cài bằng tài khoản quản trị, như decisions.py.
        root = ET.fromstring(bpmn)  # noqa: S314
    except ET.ParseError as error:
        raise ValueError(f"BPMN sai cú pháp: {error}") from error
    process = next((p for p in root.iter(f"{BPMN}process") if p.get("id") == key), None)
    if process is None:
        raise ValueError(f'không có <process id="{key}">')
    return seal_flag(process)


def document(
    instance: dict, process: str, fields: Iterable[str], tasks: list[dict], waits: list[dict]
) -> dict:
    """Bản JSON chuẩn của một hồ sơ đã kết thúc, từ dữ liệu lịch sử của Flowable.

    `instance`: historic process instance kèm biến; `fields`: mọi trường của mọi bước trong BPMN của hồ sơ;
    `tasks`, `waits`: historic task và historic activity của bước chờ. Không có tệp đính kèm: tệp gắn với dòng
    danh mục, không gắn hồ sơ (ADR 0041). Biến lõi đặt và biến người lập gửi không nằm trong bản này: chúng
    không phải nội dung người xử lý ghi, và người làm bước sau vẫn ghi đè được chúng (ADR 0031).
    """
    names = set(fields)
    variables = {v["name"]: v.get("value") for v in instance.get("variables", []) if v.get("name") in names}
    steps = [
        {
            "step": task["taskDefinitionKey"],
            "kind": "task",
            "started": _instant(task["startTime"]),
            "ended": _instant(task.get("endTime")),
            # Người nhận bước là `sub` của người hoàn thành (claim trước complete): băm gắn quyết định với
            # người ra quyết định. Bảng niêm phong chỉ giữ băm, nên mã người không ra khỏi Flowable.
            "assignee": task.get("assignee"),
            "cancelled": task.get("deleteReason") is not None,
        }
        for task in tasks
    ]
    steps += [
        {
            "step": wait["activityId"],
            "kind": "wait",
            "started": _instant(wait["startTime"]),
            "ended": _instant(wait.get("endTime")),
        }
        for wait in waits
    ]
    steps.sort(key=lambda s: (s["started"], s["kind"], s["step"], s["ended"] or 0))
    return {
        "version": VERSION,
        "case": instance["id"],
        "tenant": instance.get("tenantId") or "",
        "process": process,
        "definition": instance["processDefinitionId"],
        "started": _instant(instance["startTime"]),
        "ended": _instant(instance.get("endTime")),
        "outcome": instance.get("endActivityId"),
        "variables": variables,
        "steps": steps,
    }


def digest(doc: dict) -> bytes:
    """SHA-256 của bản JSON chuẩn: khóa sắp xếp, không khoảng trắng, UTF-8 nguyên chữ có dấu."""
    text = json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(text.encode("utf-8")).digest()


def _instant(value: str | None) -> int | None:
    # Băm thời điểm dạng số mili giây từ epoch, không băm chuỗi: Flowable đổi múi giờ hay cách viết (Z hay
    # +00:00) thì chuỗi khác mà thời điểm không đổi, và hồ sơ nguyên vẹn sẽ báo lệch.
    if value is None:
        return None
    return round(datetime.fromisoformat(value).timestamp() * 1000)
