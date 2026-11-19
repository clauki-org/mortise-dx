# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Bộ giả lập thiết bị demo (ADR 0012): đóng vai từng thiết bị trong devices.yaml, đăng nhập Mosquitto bằng tài
# khoản riêng của thiết bị đó (`<tenant>.<thiết bị>`, mật khẩu DEMO_DEVICE_PASSWORD do `make seed` cấp) và gửi
# số đo vào chủ đề của nó theo contracts/device-message.schema.json, như thiết bị thật. Không đi tắt qua cầu
# nối hay Scorpio, nên chạy giả lập là kiểm cả đường MQTT.
#   --once                 gửi một lượt rồi thoát (make smoke)
#   --interval GIÂY        gửi lặp lại (make simulate)
#   --set T/D:SỐ_ĐO=GIÁ_TRỊ  ép một số đo, ví dụ xa-a/archive-01:humidity=78 để thử vượt ngưỡng

import argparse
import json
import os
import random
import sys
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime

import paho.mqtt.client as mqtt
import yaml


@dataclass
class Device:
    tenant: str
    device: str
    measurements: list[str]
    state: dict[str, float | bool] = field(default_factory=dict)

    @property
    def username(self) -> str:
        return f"{self.tenant}.{self.device}"

    @property
    def topic(self) -> str:
        return f"mortise/{self.tenant}/{self.device}"


# Mỗi loại số đo: giá trị đầu và cách đổi sau mỗi lượt. Số liệu chỉ để minh họa, không theo thiết bị thật nào.
def _walk(value: float, step: float, low: float, high: float) -> float:
    return round(min(high, max(low, value + random.uniform(-step, step))), 1)


KINDS = {
    "temperature": (24.0, lambda v: _walk(v, 0.4, 18, 32)),  # °C
    "humidity": (65.0, lambda v: _walk(v, 1.5, 40, 90)),  # %
    "occupied": (False, lambda v: random.random() < 0.3),  # có người trong phòng
    "energy": (0.0, lambda v: round(v + random.uniform(0.01, 0.05), 3)),  # kWh cộng dồn
}


def load(path: str) -> list[Device]:
    with open(path, encoding="utf-8") as file:
        devices = [Device(e["tenant"], e["device"], list(e["measurements"])) for e in yaml.safe_load(file)]
    for device in devices:
        unknown = set(device.measurements) - KINDS.keys()
        if unknown:
            raise SystemExit(
                f"{path}: {device.topic} có số đo bộ giả lập không biết: {', '.join(sorted(unknown))}"
            )
        device.state = {name: KINDS[name][0] for name in device.measurements}
    return devices


def parse_override(text: str) -> tuple[str, str, float | bool]:
    """`xa-a/archive-01:humidity=78` thành (chủ đề, số đo, giá trị)."""
    try:
        target, assignment = text.split(":", 1)
        name, raw = assignment.split("=", 1)
    except ValueError as error:
        raise SystemExit(f"--set phải có dạng <tenant>/<thiết bị>:<số đo>=<giá trị>, nhận: {text}") from error
    if raw in {"true", "false"}:
        return f"mortise/{target}", name, raw == "true"
    try:
        return f"mortise/{target}", name, float(raw)
    except ValueError as error:
        raise SystemExit(f"--set: giá trị phải là số hay true/false, nhận: {raw}") from error


def message(device: Device, overrides: dict[tuple[str, str], float | bool]) -> bytes:
    for name in device.measurements:
        device.state[name] = KINDS[name][1](device.state[name])
        if (device.topic, name) in overrides:
            device.state[name] = overrides[(device.topic, name)]
    observed = datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    return json.dumps({"observedAt": observed, "measurements": device.state}).encode()


def connect(device: Device, host: str, port: int, password: str) -> mqtt.Client:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"sim-{device.username}")
    client.username_pw_set(device.username, password)
    try:
        client.connect(host, port, keepalive=30)
    except OSError as error:
        raise SystemExit(
            f"Không kết nối được Mosquitto tại {host}:{port} ({error}); kiểm tra `make ps`."
        ) from error
    client.loop_start()
    return client


def send(client: mqtt.Client, device: Device, payload: bytes) -> None:
    # Chờ broker xác nhận (QoS 1): --once thoát ngay sau đó, không đợi thì tin chưa kịp đi.
    info = client.publish(device.topic, payload, qos=1)
    try:
        info.wait_for_publish(timeout=10)
    except RuntimeError as error:  # publish hỏng ngay (mất kết nối, tài khoản bị từ chối)
        raise SystemExit(
            f"Không gửi được tin của {device.topic} ({error}); đã chạy `make seed` chưa?"
        ) from error
    if not info.is_published():
        raise SystemExit(
            f"Mosquitto không xác nhận tin của {device.topic}; tài khoản đã được cấp chưa (make seed)?"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Bộ giả lập thiết bị demo")
    parser.add_argument("--devices", default=os.environ.get("SIMULATOR_DEVICES", "devices.yaml"))
    parser.add_argument("--host", default=os.environ.get("MQTT_HOST", "mosquitto"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("MQTT_PORT", "1883")))
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--interval", type=float, default=5.0)
    parser.add_argument("--set", action="append", default=[], dest="overrides")
    args = parser.parse_args()
    password = os.environ.get("DEMO_DEVICE_PASSWORD")
    if not password:
        raise SystemExit("Thiếu DEMO_DEVICE_PASSWORD; chạy qua `make simulate`, lệnh này đọc .env.")

    devices = load(args.devices)
    overrides = {(topic, name): value for topic, name, value in map(parse_override, args.overrides)}
    known = {(d.topic, name) for d in devices for name in d.measurements}
    unused = sorted(f"{topic}:{name}" for topic, name in overrides.keys() - known)
    if unused:
        raise SystemExit(f"--set trỏ tới số đo không có trong {args.devices}: {', '.join(unused)}")
    clients = {device.topic: connect(device, args.host, args.port, password) for device in devices}
    try:
        while True:
            for device in devices:
                send(clients[device.topic], device, message(device, overrides))
            print(f"đã gửi số đo của {len(devices)} thiết bị", flush=True)
            if args.once:
                return 0
            time.sleep(args.interval)
    finally:
        for client in clients.values():
            client.disconnect()
            client.loop_stop()


if __name__ == "__main__":
    sys.exit(main())
