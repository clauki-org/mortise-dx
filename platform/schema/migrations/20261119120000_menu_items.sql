-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Mục menu của các gói đã cài (mục `menu` trong app.yaml), một dòng mỗi mục mỗi tenant. Khung giao diện đọc bảng này
-- qua GraphQL để dựng menu và mở thành phần với cấu hình của gói. Bộ cài gói (scripts/app-deploy.py) ghi và xóa;
-- người dùng không sửa.

-- migrate:up
CREATE TABLE platform.menu_items (
    tenant_id  text NOT NULL REFERENCES core.tenants (id) ON DELETE CASCADE,
    -- Gói sở hữu mục này (id trong app.yaml); gỡ gói thì xóa theo cột này.
    app        text NOT NULL,
    item       text NOT NULL,
    -- Thứ tự trong app.yaml, để menu hiện đúng thứ tự gói khai.
    position   integer NOT NULL,
    label      text NOT NULL,
    component  text NOT NULL,
    -- Nội dung tệp cấu hình của thành phần, không phải đường dẫn: giao diện chạy trong trình duyệt, không đọc được
    -- thư mục apps/. Cấu hình danh mục đã kiểm theo schema ở `make check-fast`.
    config     jsonb NOT NULL,
    -- Vai trò thấy mục này; NULL (app.yaml không khai hoặc khai rỗng) là mọi người. Chỉ quyết định mục có hiện trên menu hay không: dữ liệu sau mục vẫn
    -- do quyền Hasura và workflow-api bảo vệ.
    roles      text[],
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, app, item)
);

-- Đổi menu là đổi điều người dùng thấy và mở được, nên có nhật ký như khai báo bước (ADR 0009).
SELECT core.audit_attach('platform.menu_items');

-- migrate:down
SELECT core.audit_detach('platform.menu_items');
DROP TABLE platform.menu_items;
