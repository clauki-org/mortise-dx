# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Cầu nối MQTT sang NGSI-LD (dịch vụ iot-bridge trong compose.yaml, ADR 0012): đăng ký nhận mọi chủ đề số
# đo `mortise/+/+` trên Mosquitto, đổi từng tin thành entity (message.py), kiểm tenant (tenants.py) rồi
# ghi vào Scorpio (scorpio.py). Một tin hỏng chỉ bị bỏ kèm một dòng log, vòng nhận tin không dừng.

import logging
import os
from pathlib import Path

import paho.mqtt.client as mqtt

from . import config
from .message import Rejected, parse
from .scorpio import Scorpio, Unavailable
from .tenants import TenantCheck, database_lookup

TOPIC = "mortise/+/+"
# Healthcheck của Docker đọc tệp này: có nghĩa là đã kết nối và đăng ký nhận tin xong.
READY = Path(os.environ.get("BRIDGE_READY_FILE", "/tmp/iot-bridge-ready"))  # noqa: S108

log = logging.getLogger("iot-bridge")


class Bridge:
    def __init__(self, tenants: TenantCheck, scorpio: Scorpio):
        self._tenants = tenants
        self._scorpio = scorpio

    def handle(self, topic: str, payload: bytes) -> bool:
        """Xử lý một tin; True nếu đã ghi. Mọi lỗi đều ghi log và trả False, không ném ra ngoài."""
        try:
            reading = parse(topic, payload)
            if not self._tenants.exists(reading.tenant):
                log.warning("Bỏ tin của tenant không có trong core.tenants: %s", reading.tenant)
                return False
            self._scorpio.upsert(reading.tenant, reading.entity)
            return True
        except Rejected as error:
            log.warning("Bỏ tin không hợp lệ: %s", error)
        except Unavailable as error:
            log.error("Không ghi được số đo của %s: %s", topic[:200], error)
        except Exception:
            log.exception("Lỗi không lường trước khi xử lý tin của %s", topic[:200])
        return False


def client_for(bridge: Bridge, settings: config.Settings) -> mqtt.Client:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="iot-bridge")
    client.username_pw_set(settings.mqtt_user, settings.mqtt_password)

    # Đăng ký lại sau mỗi lần kết nối: Mosquitto không giữ phiên (persistence tắt).
    def on_connect(client, _userdata, _flags, reason, _properties):
        if reason.is_failure:
            log.error("Mosquitto từ chối kết nối: %s", reason)
            return
        client.subscribe(TOPIC, qos=1)

    def on_subscribe(_client, _userdata, _mid, reasons, _properties):
        if any(reason.is_failure for reason in reasons):
            log.error("Mosquitto từ chối đăng ký %s: %s", TOPIC, reasons)
            return
        READY.touch()
        log.info("Đã đăng ký nhận %s", TOPIC)

    def on_disconnect(_client, _userdata, _flags, reason, _properties):
        READY.unlink(missing_ok=True)
        log.warning("Mất kết nối Mosquitto (%s); tự kết nối lại", reason)

    client.on_connect = on_connect
    client.on_subscribe = on_subscribe
    client.on_disconnect = on_disconnect
    client.on_message = lambda _client, _userdata, message: bridge.handle(message.topic, message.payload)
    return client


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    settings = config.load()
    lookup = database_lookup(settings.db_host, settings.db_name, settings.db_user, settings.db_password)
    bridge = Bridge(TenantCheck(lookup), Scorpio(settings.scorpio_url))
    client = client_for(bridge, settings)
    client.reconnect_delay_set(min_delay=1, max_delay=30)
    client.connect_async(settings.mqtt_host, settings.mqtt_port, keepalive=30)
    client.loop_forever(retry_first_connection=True)


if __name__ == "__main__":
    main()
