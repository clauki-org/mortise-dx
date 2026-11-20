# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Xét luật ngưỡng (contracts/threshold-rule.schema.json): số đo vượt ngưỡng liên tục đủ lâu thì phải mở hồ sơ.
# Hàm thuần, không gọi mạng, để kiểm thử đầy đủ; watch.py lấy luật, lịch sử số đo rồi hỏi các hàm ở đây.

import hashlib
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class Rule:
    app: str
    id: str
    title: str
    entity_type: str
    measurement: str
    above: float | None
    below: float | None
    hold_seconds: int
    process: str

    @classmethod
    def from_definition(cls, app: str, definition: dict) -> "Rule":
        return cls(
            app=app,
            id=definition["id"],
            title=definition["title"],
            entity_type=definition["entityType"],
            measurement=definition["measurement"],
            above=definition.get("above"),
            below=definition.get("below"),
            hold_seconds=definition["holdSeconds"],
            process=definition["process"],
        )

    @property
    def threshold(self) -> float:
        return self.above if self.above is not None else self.below  # type: ignore[return-value]


@dataclass(frozen=True)
class Sample:
    observed_at: datetime
    value: object


def breaches(rule: Rule, value: object) -> bool:
    # true/false không so với ngưỡng số: bool là con của int trong Python, nên phải loại riêng.
    if isinstance(value, bool) or not isinstance(value, int | float):
        return False
    if rule.above is not None:
        return value > rule.above
    return rule.below is not None and value < rule.below


def held(rule: Rule, samples: list[Sample]) -> bool:
    """Lần đo mới nhất vượt ngưỡng và chuỗi lần đo vượt liền nhau kéo dài ít nhất hold_seconds.

    Một lần đo vượt đơn lẻ giữa các lần đo bình thường có độ dài 0 nên không đủ. Lịch sử chỉ gồm các lần đo
    đã lấy về: chuỗi dài hơn số lần đo lấy về thì tính từ lần cũ nhất có trong đó.
    """
    ordered = sorted(samples, key=lambda sample: sample.observed_at, reverse=True)
    if not ordered or not breaches(rule, ordered[0].value):
        return False
    start = ordered[0].observed_at
    for sample in ordered[1:]:
        if not breaches(rule, sample.value):
            break
        start = sample.observed_at
    return (ordered[0].observed_at - start).total_seconds() >= rule.hold_seconds


def case_key(rule: Rule, device: str) -> str:
    """Idempotency-Key của hồ sơ cho một luật trên một thiết bị, trong một tenant.

    Băm thay vì ghép chuỗi: mã thiết bị dài tới 64 ký tự cộng mã gói và mã luật sẽ vượt 100 ký tự mà
    workflow-api nhận, và băm không có ký tự ngoài tập [A-Za-z0-9_-].
    """
    digest = hashlib.sha256(f"{rule.app}/{rule.id}/{device}".encode()).hexdigest()
    return f"threshold-{digest[:40]}"
