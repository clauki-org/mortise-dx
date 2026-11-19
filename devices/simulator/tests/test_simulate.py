# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử phần thuần của bộ giả lập: danh sách thiết bị demo đọc được, tin đúng dạng của hợp đồng
# (contracts/device-message.schema.json: khóa observedAt và measurements, số đo là số hay true/false),
# --set ép đúng số đo.

import json
from pathlib import Path

import pytest

from simulate import KINDS, load, message, parse_override

DEVICES = str(Path(__file__).resolve().parent.parent / "devices.yaml")


def test_demo_devices_only_use_known_measurements():
    devices = load(DEVICES)
    assert devices and all(set(d.measurements) <= KINDS.keys() for d in devices)


def test_message_has_only_contract_fields_and_values():
    device = load(DEVICES)[0]
    body = json.loads(message(device, {}))
    assert set(body) == {"observedAt", "measurements"}
    assert body["observedAt"].endswith("Z")
    assert set(body["measurements"]) == set(device.measurements)
    assert all(isinstance(v, int | float | bool) for v in body["measurements"].values())


def test_override_forces_one_measurement():
    device = next(d for d in load(DEVICES) if "humidity" in d.measurements)
    topic, name, value = parse_override(f"{device.tenant}/{device.device}:humidity=78")
    assert json.loads(message(device, {(topic, name): value}))["measurements"]["humidity"] == 78


@pytest.mark.parametrize("text", ["xa-a/archive-01", "xa-a/archive-01:humidity=abc"])
def test_malformed_override_is_refused(text):
    with pytest.raises(SystemExit):
        parse_override(text)
