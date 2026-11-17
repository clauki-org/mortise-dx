# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Cấu hình đọc từ biến môi trường do compose.yaml truyền vào; thiếu biến thì dừng ngay
# lúc khởi động thay vì lỗi giữa chừng.

import os
from dataclasses import dataclass


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Thiếu biến môi trường {name}; xem compose.yaml.")
    return value


@dataclass(frozen=True)
class Settings:
    mqtt_host: str
    mqtt_port: int
    mqtt_user: str
    mqtt_password: str
    scorpio_url: str
    db_host: str
    db_name: str
    db_user: str
    db_password: str


def load() -> Settings:
    return Settings(
        mqtt_host=_required("MQTT_HOST"),
        mqtt_port=int(_required("MQTT_PORT")),
        mqtt_user=_required("MQTT_USER"),
        mqtt_password=_required("MQTT_PASSWORD"),
        scorpio_url=_required("SCORPIO_URL"),
        db_host=_required("BRIDGE_DB_HOST"),
        db_name=_required("BRIDGE_DB_NAME"),
        db_user=_required("BRIDGE_DB_USER"),
        db_password=_required("BRIDGE_DB_PASSWORD"),
    )
