-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Migration đầu tiên của lõi (ADR 0005): lược đồ `core` và bảng tenant. Bảng của gói
-- nghiệp vụ nằm trong lược đồ riêng của gói, với lịch sử migration riêng.

-- migrate:up
CREATE SCHEMA IF NOT EXISTS core;

-- Mỗi tenant là một đơn vị dùng chung lõi nhưng dữ liệu tách biệt.
-- id trùng với tên group trong Keycloak (claim `tenant`).
-- IF NOT EXISTS: bản cài dựng trước khi có migration đã có bảng này từ script init;
-- không có nó, lần `make up` đầu tiên trên bản cài đó sẽ lỗi "relation already exists".
CREATE TABLE IF NOT EXISTS core.tenants (
    id         text PRIMARY KEY,
    name       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE core.tenants;
