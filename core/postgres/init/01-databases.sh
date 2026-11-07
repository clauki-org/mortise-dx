#!/bin/bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Chạy một lần khi volume Postgres còn trống: tạo CSDL riêng cho Keycloak và Flowable,
# và CSDL nghiệp vụ `dxos` (Hasura dùng chung CSDL này cho metadata). Volume đã có dữ
# liệu từ trước thì script không chạy lại: cần `make reset`.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username postgres <<SQL
CREATE ROLE keycloak LOGIN PASSWORD '${KEYCLOAK_DB_PASSWORD}';
CREATE DATABASE keycloak OWNER keycloak;

CREATE ROLE flowable LOGIN PASSWORD '${FLOWABLE_DB_PASSWORD}';
CREATE DATABASE flowable OWNER flowable;

CREATE ROLE hasura LOGIN PASSWORD '${HASURA_DB_PASSWORD}';
CREATE DATABASE dxos OWNER hasura;
SQL

psql -v ON_ERROR_STOP=1 --username postgres --dbname dxos <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL

psql -v ON_ERROR_STOP=1 --username hasura --dbname dxos -f /docker-entrypoint-initdb.d/sql/10-core.sql
