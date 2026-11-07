-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Lược đồ lõi, không phụ thuộc đề tài. Bảng nghiệp vụ của từng module
-- nằm trong lược đồ riêng của module.

CREATE SCHEMA IF NOT EXISTS core;

-- Mỗi tenant là một đơn vị dùng chung lõi nhưng dữ liệu tách biệt.
-- id trùng với tên group trong Keycloak (claim `tenant`).
CREATE TABLE core.tenants (
    id         text PRIMARY KEY,
    name       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO core.tenants (id, name) VALUES
    ('xuong-a', 'Tenant A (demo)'),
    ('xuong-b', 'Tenant B (demo)');
