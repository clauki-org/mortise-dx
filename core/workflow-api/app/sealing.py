# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Niêm phong hồ sơ và ghi hạn của bước chờ (ADR 0053), nối Flowable (lịch sử, hẹn giờ) với CSDL (db.py).
# main.py gọi sau khi khởi tạo hay hoàn thành một bước; route đọc trạng thái gọi status() để trả và bù niêm
# phong. seal_verify.py dựng lại bản JSON bằng cùng hàm case_digest() ở đây. Chỉ quy trình khai cờ niêm phong
# hay có bước chờ mới chạm CSDL và gọi thêm Flowable.

import logging

from . import db, flowable, history
from .policy import Denied
from .seal import VERSION, digest, document

log = logging.getLogger("workflow-api.sealing")


def after_step(instance_id: str, definition: flowable.Definition, actor: str | None) -> None:
    """Sau khi khởi tạo hay hoàn thành một bước: ghi hạn nếu hồ sơ vừa vào bước chờ, niêm phong nếu vừa kết
    thúc.

    Lỗi không làm hỏng lời gọi: bước đã hoàn thành ở Flowable, trả lỗi thì người dùng bấm lại và nhận 404. Lỗi
    được ghi log; niêm phong thiếu được bù khi có người mở hồ sơ (status), hạn thiếu thì bước chờ đó không có
    dòng trong core.case_deadlines.
    """
    try:
        if definition.waits:
            record_deadlines(instance_id, definition)
        if definition.seal:
            found = flowable.instance(instance_id)
            if found is not None and _completed(found):
                seal_case(found, actor)
    except Denied as error:
        log.error("Không ghi được niêm phong hay hạn của hồ sơ %s: %s", instance_id, error.reason)


def record_deadlines(instance_id: str, definition: flowable.Definition) -> None:
    """Ghi hạn của các hẹn giờ đang chờ ở bước chờ. Hẹn giờ của sự kiện biên (gắn vào userTask) không phải
    bước chờ, nên không ghi."""
    jobs = [job for job in flowable.timer_jobs(instance_id) if job.get("elementId") in definition.waits]
    if not jobs:
        return
    process = flowable.process_key(jobs[0]["processDefinitionId"])
    db.insert_deadlines(
        [
            {
                "case": instance_id,
                "tenant": job.get("tenantId") or "",
                "process": process,
                "activity": job["elementId"],
                "due": job["dueDate"],
            }
            for job in jobs
        ]
    )


def status(raw: dict, definition: flowable.Definition) -> dict | None:
    """Trạng thái niêm phong trả cho người xem; hồ sơ đã kết thúc mà chưa có dòng thì niêm phong ngay (bù).

    None: quy trình không khai niêm phong, hồ sơ chưa kết thúc hay bị xóa giữa chừng.
    """
    if not definition.seal or not _completed(raw):
        return None
    found = db.seal(raw["id"])
    if found is None:
        seal_case(raw, None)
        found = db.seal(raw["id"])
    return found


def case_digest(instance_id: str) -> tuple[dict, bytes] | None:
    """(bản JSON chuẩn, băm) dựng từ lịch sử Flowable; None nếu Flowable không còn hồ sơ này."""
    query = {"processInstanceId": instance_id, "includeProcessVariables": True}
    response = flowable._call("POST", "/query/historic-process-instances", json=query)
    flowable._ensure_ok(response, "đọc hồ sơ để niêm phong")
    found = [raw for raw in response.json()["data"] if raw["id"] == instance_id]
    if not found:
        return None
    raw = found[0]
    definition = flowable.definition_of(raw["processDefinitionId"])
    fields = {name for names in definition.fields.values() for name in names}
    doc = document(
        raw,
        flowable.process_key(raw["processDefinitionId"]),
        fields,
        history.task_history(instance_id, complete=True),
        history.wait_history(instance_id, complete=True),
    )
    return doc, digest(doc)


def seal_case(raw: dict, actor: str | None) -> None:
    """Niêm phong hồ sơ đã kết thúc `raw` (historic process instance). Tenant lấy từ hồ sơ, không từ người
    gọi: bước cuối có thể do người của tenant cha hoàn thành (ADR 0029)."""
    built = case_digest(raw["id"])
    if built is None:
        raise Denied(502, f"Flowable không còn lịch sử của hồ sơ {raw['id']} để niêm phong.")
    doc, value = built
    db.insert_seal(doc["case"], doc["tenant"], doc["process"], VERSION, value.hex(), actor)


def _completed(raw: dict) -> bool:
    # Chỉ hồ sơ đi tới một sự kiện kết thúc. Hồ sơ bị xóa giữa chừng (endActivityId null, ADR 0032) không có
    # kết quả để niêm phong; nó vẫn còn trong lịch sử của Flowable.
    return raw.get("endTime") is not None and raw.get("endActivityId") is not None
