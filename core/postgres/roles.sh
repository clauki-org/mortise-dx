#!/bin/bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Vai trò CSDL của các dịch vụ tự viết, chạy mỗi lần `make up` trước migration (dịch vụ db-roles trong
# compose.yaml). Script init chỉ chạy khi volume còn trống, nên vai trò thêm sau đó phải tạo ở đây thì bản
# cài đã có dữ liệu mới nâng cấp được bằng `make up`, không phải `make reset` (ADR 0005). Chạy lại nhiều lần
# vẫn đúng: vai trò đã có thì chỉ đặt lại mật khẩu theo .env. Quyền trên bảng do migration cấp.
set -euo pipefail

psql -v ON_ERROR_STOP=1 -v files_password="$FILES_DB_PASSWORD" --host postgres --username postgres --dbname mortise <<'SQL'
SELECT 'CREATE ROLE files_api LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'files_api') \gexec
ALTER ROLE files_api PASSWORD :'files_password';
SQL
echo "db-roles: vai trò files_api sẵn sàng"

psql -v ON_ERROR_STOP=1 -v bridge_password="$IOT_BRIDGE_DB_PASSWORD" --host postgres --username postgres --dbname mortise <<'SQL'
SELECT 'CREATE ROLE iot_bridge LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'iot_bridge') \gexec
ALTER ROLE iot_bridge PASSWORD :'bridge_password';
SQL
echo "db-roles: vai trò iot_bridge sẵn sàng"

psql -v ON_ERROR_STOP=1 -v assistant_password="$ASSISTANT_DB_PASSWORD" --host postgres --username postgres --dbname mortise <<'SQL'
SELECT 'CREATE ROLE assistant LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'assistant') \gexec
ALTER ROLE assistant PASSWORD :'assistant_password';
SQL
echo "db-roles: vai trò assistant sẵn sàng"
