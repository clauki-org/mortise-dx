-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Thông tin tệp tải lên qua /v1/files (core/files-api). Nội dung nằm trong SeaweedFS với khóa
-- <tenant>/<id>; bảng này giữ tên, cỡ, băm, người tải và trạng thái quét để tra cứu và để giao
-- diện liệt kê tệp qua GraphQL sau này.

-- migrate:up
-- Vai trò files_api do core/postgres/roles.sh tạo trước migration, vì migration chạy bằng vai trò hasura vốn không
-- được tạo vai trò.

CREATE TABLE core.files (
    id           uuid PRIMARY KEY,
    tenant_id    text NOT NULL REFERENCES core.tenants (id),
    name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
    content_type text NOT NULL,
    size         bigint NOT NULL CHECK (size > 0),
    sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    -- `sub` của người tải lên trong token.
    uploaded_by  text NOT NULL,
    -- Chưa có bước quét mã độc; khi có, migration sau thêm các trạng thái kết quả.
    status       text NOT NULL DEFAULT 'unscanned' CHECK (status IN ('unscanned')),
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX files_tenant_created ON core.files (tenant_id, created_at);

-- files-api chỉ đọc và thêm dòng của bảng này; không sửa, không xóa, không thấy bảng khác.
GRANT USAGE ON SCHEMA core TO files_api;
GRANT SELECT, INSERT ON core.files TO files_api;

-- migrate:down
DROP TABLE core.files;
REVOKE USAGE ON SCHEMA core FROM files_api;
