-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Cầu nối IoT (core/iot-bridge, ADR 0012) kiểm tenant trong chủ đề MQTT có thật trước khi ghi vào Scorpio.
-- Vai trò iot_bridge do core/postgres/roles.sh tạo trước migration; ở đây chỉ cấp quyền đọc đúng bảng đó.

-- migrate:up
GRANT USAGE ON SCHEMA core TO iot_bridge;
GRANT SELECT ON core.tenants TO iot_bridge;

-- migrate:down
REVOKE SELECT ON core.tenants FROM iot_bridge;
REVOKE USAGE ON SCHEMA core FROM iot_bridge;
