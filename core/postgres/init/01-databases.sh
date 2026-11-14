#!/bin/bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Chạy một lần khi volume Postgres còn trống: tạo vai trò, CSDL riêng cho Keycloak và
# Flowable, CSDL nghiệp vụ `mortise` (Hasura dùng chung cho metadata) và bật phần mở rộng.
# Đây là những việc cần quyền quản trị CSDL. Bảng và lược đồ không tạo ở đây mà bằng
# migration trong core/postgres/migrations/ (ADR 0005), để bản cài đã có dữ liệu vẫn
# nhận được thay đổi lược đồ.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username postgres <<SQL
CREATE ROLE keycloak LOGIN PASSWORD '${KEYCLOAK_DB_PASSWORD}';
CREATE DATABASE keycloak OWNER keycloak;

CREATE ROLE flowable LOGIN PASSWORD '${FLOWABLE_DB_PASSWORD}';
CREATE DATABASE flowable OWNER flowable;

CREATE ROLE hasura LOGIN PASSWORD '${HASURA_DB_PASSWORD}';
CREATE DATABASE mortise OWNER hasura;
SQL

psql -v ON_ERROR_STOP=1 --username postgres --dbname mortise <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
