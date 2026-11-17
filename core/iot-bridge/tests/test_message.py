# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử việc đổi tin MQTT thành entity NGSI-LD: tenant và thiết bị chỉ từ chủ đề, số đo phải là số,
# tên số đo không được trùng tên dành riêng của NGSI-LD.

import json

import pytest

from app.message import MAX_MEASUREMENTS, Rejected, parse

TOPIC = "mortise/xuong-a/archive-01"


def body(**fields) -> bytes:
    return json.dumps(fields).encode()


def test_measurements_become_properties_with_observed_at():
    reading = parse(TOPIC, body(observedAt="2026-11-17T17:00:00+07:00", measurements={"humidity": 71.5}))
    assert (reading.tenant, reading.device) == ("xuong-a", "archive-01")
    assert reading.entity == {
        "id": "urn:ngsi-ld:Device:archive-01",
        "type": "Device",
        "humidity": {"type": "Property", "value": 71.5, "observedAt": "2026-11-17T10:00:00Z"},
    }


def test_tenant_in_payload_is_rejected():
    # Như contracts/examples/invalid/device-message.tenant-in-body.json: tenant chỉ đến từ chủ đề.
    with pytest.raises(Rejected):
        parse(TOPIC, body(tenant="xuong-b", measurements={"occupied": True}))


def test_boolean_measurement_is_kept():
    assert parse(TOPIC, body(measurements={"occupied": True})).entity["occupied"]["value"] is True


@pytest.mark.parametrize(
    "topic",
    [
        "mortise/xuong-a",
        "mortise/xuong-a/archive-01/extra",
        "other/xuong-a/archive-01",
        "mortise/Xuong-A/a",
        "mortise/xuong-a/a" + "b" * 64,
        "mortise/../archive-01",
    ],
)
def test_topic_must_be_mortise_tenant_device(topic):
    with pytest.raises(Rejected):
        parse(topic, body(measurements={"humidity": 1}))


@pytest.mark.parametrize(
    "measurements",
    [
        {},
        {"id": 1},
        {"type": 1},
        {"location": 1},
        {"@context": 1},
        {"Humidity": 1},
        {"humidity": "71"},
        {"humidity": None},
        {"humidity": [1]},
        {f"m{i}": 1 for i in range(MAX_MEASUREMENTS + 1)},
    ],
)
def test_bad_measurements_are_rejected(measurements):
    with pytest.raises(Rejected):
        parse(TOPIC, body(measurements=measurements))


@pytest.mark.parametrize(
    "payload",
    [
        b"not json",
        b"[1, 2]",
        b"\xff\xfe",
        body(measurements={"a": 1}, observedAt="2026-11-17T10:00:00"),
        body(measurements={"a": 1}, observedAt="2026-11-17 10:00:00Z"),
        body(measurement={"a": 1}),
        b"{" + b" " * 5000 + b"}",
    ],
)
def test_bad_payloads_are_rejected(payload):
    with pytest.raises(Rejected):
        parse(TOPIC, payload)
