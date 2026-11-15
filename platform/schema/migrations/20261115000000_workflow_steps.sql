-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Migration đầu tiên của Tầng 2 (ADR 0005: mỗi phần một lịch sử migration, bảng theo dõi
-- platform.schema_migrations). Lược đồ `platform` chứa cấu hình mà thành phần dùng chung đọc lúc chạy, không
-- chứa dữ liệu nghiệp vụ.

-- migrate:up
CREATE SCHEMA IF NOT EXISTS platform;

-- Khai báo bước của quy trình (contracts/workflow.schema.json), một dòng mỗi bước. Bảng việc ghép task của
-- workflow-api với dòng có cùng process và step để biết hiện biểu mẫu nào, nút nào. Theo tenant vì quy trình
-- được deploy theo tenant; xóa tenant thì khai báo của nó đi theo.
CREATE TABLE platform.workflow_steps (
    tenant_id  text NOT NULL REFERENCES core.tenants (id) ON DELETE CASCADE,
    process    text NOT NULL,
    step       text NOT NULL,
    -- Phần khai báo của một bước (form, ui, actions, record), đã kiểm theo schema trước khi nạp.
    config     jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, process, step)
);

-- migrate:down
DROP TABLE platform.workflow_steps;
