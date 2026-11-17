#!/bin/sh
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Khởi động Mosquitto (dịch vụ mosquitto trong compose.yaml). Tài khoản thiết bị nằm trong volume và giữ
# qua các lần khởi động; tài khoản của cầu nối đặt lại mỗi lần theo MQTT_BRIDGE_PASSWORD trong .env, để đổi
# mật khẩu chỉ cần sửa .env rồi `make up`. Mosquitto 2 từ chối tệp mà người khác đọc được, nên chỉnh quyền
# trước khi chạy.
set -eu
auth=/mosquitto/auth
touch "$auth/passwd" "$auth/acl"
mosquitto_passwd -b "$auth/passwd" iot-bridge "$MQTT_BRIDGE_PASSWORD" 2>/dev/null
# Cầu nối đọc mọi chủ đề số đo. Khối này dựng lại mỗi lần khởi động và
# luôn đứng đầu tệp acl; thiết bị do scripts/device.sh thêm phía sau.
sed '/^user iot-bridge$/,/^$/d' "$auth/acl" >"$auth/acl.devices"
{ printf 'user iot-bridge\ntopic read mortise/#\n\n'; cat "$auth/acl.devices"; } >"$auth/acl.new"
# Thay tệp một lần (mv): container dừng giữa chừng không để lại tệp acl ghi dở, mất quyền của thiết bị.
mv "$auth/acl.new" "$auth/acl"
rm -f "$auth/acl.devices"
chown mosquitto:mosquitto "$auth/passwd" "$auth/acl"
chmod 0600 "$auth/passwd" "$auth/acl"
exec mosquitto -c /mosquitto/config/mosquitto.conf
