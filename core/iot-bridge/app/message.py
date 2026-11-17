# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Đổi một tin MQTT của thiết bị thành entity NGSI-LD. Hàm thuần, không gọi mạng, để kiểm thử đầy đủ.
#
# Tenant và mã thiết bị chỉ lấy từ chủ đề `mortise/<tenant>/<thiết bị>`, không bao giờ từ nội dung tin:
# Mosquitto chỉ cho mỗi tài khoản thiết bị gửi vào đúng chủ đề của nó (scripts/device.sh), nên chủ đề là
# thứ duy nhất thiết bị không giả được.
#
# Nội dung tin: {"observedAt": "<ISO 8601, tùy chọn>", "measurements": {"<tên>": <số hay true/false>, ...}}

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime

_SLUG = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")
# Tên thuộc tính NGSI-LD do thiết bị đặt; chữ thường đứng đầu, như temperature, energyTotal.
_NAME = re.compile(r"[a-z][A-Za-z0-9]{0,63}")
# Tên NGSI-LD dành riêng: thiết bị đặt các tên này thì ghi đè mã, loại hay vị trí của entity.
RESERVED = frozenset(
    {
        "id",
        "type",
        "scope",
        "location",
        "observationSpace",
        "operationSpace",
        "createdAt",
        "modifiedAt",
        "deletedAt",
        "observedAt",
    }
)
MAX_MEASUREMENTS = 20
MAX_PAYLOAD = 4096
FIELDS = frozenset({"observedAt", "measurements"})
# Cùng mẫu với contracts/device-message.schema.json; datetime.fromisoformat một mình nhận rộng hơn (dấu cách
# thay chữ T, dạng rút gọn), nên kiểm mẫu trước để cầu nối và hợp đồng nhận đúng một tập.
_ISO = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})")


class Rejected(ValueError):
    """Tin không dùng được; cầu nối ghi log rồi bỏ, không dừng."""


@dataclass(frozen=True)
class Reading:
    tenant: str
    device: str
    entity: dict


def topic_parts(topic: str) -> tuple[str, str]:
    parts = topic.split("/")
    if len(parts) != 3 or parts[0] != "mortise" or not all(_SLUG.fullmatch(p) for p in parts[1:]):
        raise Rejected(f"chủ đề không đúng dạng mortise/<tenant>/<thiết bị>: {topic[:200]}")
    if len(parts[2]) > 64:
        raise Rejected("mã thiết bị dài quá 64 ký tự")
    return parts[1], parts[2]


def _observed_at(value: object) -> str:
    if value is None:
        return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    if not isinstance(value, str) or not _ISO.fullmatch(value):
        raise Rejected("observedAt phải là ISO 8601 có múi giờ, ví dụ 2026-11-17T10:00:00Z")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as error:
        raise Rejected(f"observedAt không đọc được: {value[:40]}") from error
    if parsed.tzinfo is None:
        raise Rejected("observedAt phải có múi giờ, ví dụ 2026-11-17T10:00:00Z")
    return parsed.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _measurements(value: object) -> dict[str, int | float | bool]:
    if not isinstance(value, dict) or not value:
        raise Rejected("measurements phải là đối tượng có ít nhất một số đo")
    if len(value) > MAX_MEASUREMENTS:
        raise Rejected(f"nhiều quá {MAX_MEASUREMENTS} số đo trong một tin")
    for name, reading in value.items():
        if not _NAME.fullmatch(name) or name in RESERVED:
            raise Rejected(f"tên số đo không dùng được: {name[:64]}")
        # bool là con của int trong Python nên nhận cả hai; không nhận NaN hay vô cực vì JSON không biểu
        # diễn được.
        if not isinstance(reading, int | float) or reading != reading or abs(reading) == float("inf"):
            raise Rejected(f"số đo {name} phải là số hay true/false")
    return value


def parse(topic: str, payload: bytes) -> Reading:
    tenant, device = topic_parts(topic)
    if len(payload) > MAX_PAYLOAD:
        raise Rejected(f"tin dài quá {MAX_PAYLOAD} byte")
    try:
        body = json.loads(payload)
    except (UnicodeDecodeError, ValueError) as error:
        raise Rejected("nội dung không phải JSON") from error
    if not isinstance(body, dict):
        raise Rejected("nội dung phải là đối tượng JSON")
    # Khóa lạ bị từ chối như hợp đồng nói, kể cả "tenant": thiết bị không đặt được tenant, và khóa gõ sai
    # (ví dụ "measurement") lộ ra ngay thay vì số đo lặng lẽ không tới.
    unknown = sorted(set(body) - FIELDS)
    if unknown:
        raise Rejected(f"khóa không hỗ trợ: {', '.join(name[:40] for name in unknown[:5])}")
    observed = _observed_at(body.get("observedAt"))
    entity: dict = {"id": f"urn:ngsi-ld:Device:{device}", "type": "Device"}
    for name, reading in _measurements(body.get("measurements")).items():
        entity[name] = {"type": "Property", "value": reading, "observedAt": observed}
    return Reading(tenant=tenant, device=device, entity=entity)
