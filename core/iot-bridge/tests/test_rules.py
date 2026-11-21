# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử xét luật ngưỡng: vượt liên tục đủ lâu mới mở hồ sơ, một lần đo vượt đơn lẻ thì không, và mã chống
# mở trùng luôn hợp lệ với workflow-api.

import re
from datetime import UTC, datetime, timedelta

from app.rules import Rule, Sample, breaches, case_key, held

T0 = datetime(2026, 11, 20, 10, 0, tzinfo=UTC)
RULE = Rule.from_definition(
    "core",
    {
        "id": "test-level-high",
        "title": "Kiểm thử",
        "entityType": "Device",
        "measurement": "testLevel",
        "above": 100,
        "holdSeconds": 60,
        "process": "core-approval",
    },
)


def series(*values: float, step: int = 20) -> list[Sample]:
    """Các lần đo cách nhau `step` giây, lần cuối là mới nhất."""
    return [Sample(T0 + timedelta(seconds=step * i), value) for i, value in enumerate(values)]


def test_breach_held_long_enough_fires():
    assert held(RULE, series(50, 120, 130, 125, 140))


def test_breach_shorter_than_hold_does_not_fire():
    assert not held(RULE, series(50, 50, 120, 130))


def test_single_spike_between_normal_readings_does_not_fire():
    assert not held(RULE, series(64, 319.5, 65.9))
    assert not held(RULE, series(64, 65, 319.5))


def test_latest_reading_back_to_normal_does_not_fire():
    assert not held(RULE, series(120, 130, 140, 150, 90))


def test_order_of_samples_does_not_matter():
    assert held(RULE, list(reversed(series(50, 120, 130, 125, 140))))


def test_below_threshold_rule():
    rule = Rule.from_definition("core", {**_definition(), "below": 10})
    assert breaches(rule, 5) and not breaches(rule, 10)


def test_booleans_and_text_never_breach():
    assert not breaches(RULE, True)
    assert not breaches(RULE, "200")


def test_empty_history_does_not_fire():
    assert not held(RULE, [])


def test_case_key_fits_workflow_api():
    key = case_key(RULE, "d" * 64)
    assert re.fullmatch(r"[A-Za-z0-9_-]{8,100}", key)
    assert key != case_key(RULE, "d" * 63)
    other = Rule.from_definition("facilities-commune", _definition())
    assert case_key(other, "archive-01") != case_key(RULE, "archive-01")


def _definition() -> dict:
    return {
        "id": "test-level-high",
        "title": "Kiểm thử",
        "entityType": "Device",
        "measurement": "testLevel",
        "holdSeconds": 60,
        "process": "core-approval",
    }
