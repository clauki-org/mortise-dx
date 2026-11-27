-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Phiếu công việc tại một điểm lắp đặt (khảo sát, lắp đặt, nghiệm thu, sửa chữa), giấy tờ đính kèm phiếu (ảnh, biên
-- bản; ADR 0041) và hai view số cho bảng điều hành (ADR 0033). Phiếu là dòng của gói do người dùng lập; hồ sơ sửa chữa
-- do luật ngưỡng mở là quy trình, không phải dòng ở đây (gói không có mã nên quy trình không ghi được dòng).

-- migrate:up
CREATE TABLE app_field_ops.work_orders (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  text NOT NULL,
    code       text NOT NULL CHECK (code <> ''),
    site_code  text NOT NULL,
    kind       text NOT NULL CHECK (kind IN ('survey', 'install', 'acceptance', 'repair')),
    title      text NOT NULL CHECK (title <> '' AND length(title) <= 200),
    -- Tên người thực hiện, chữ tự do: gói không đọc được danh bạ tài khoản của Keycloak.
    assignee   text CHECK (length(assignee) <= 200),
    due_on     date,
    status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
    note       text CHECK (length(note) <= 2000),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, site_code) REFERENCES app_field_ops.sites (tenant_id, code) ON DELETE RESTRICT,
    UNIQUE (tenant_id, code),
    -- Đích của khóa ngoại ghép từ bảng giấy tờ.
    UNIQUE (tenant_id, id)
);

CREATE TABLE app_field_ops.work_order_documents (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     text NOT NULL,
    work_order_id uuid NOT NULL,
    -- Khóa ngoại một cột như giấy tờ của gói xã: core.files không có UNIQUE (tenant_id, id). Tệp của tenant khác gắn
    -- vào đây cũng không mở được, vì files-api chỉ trả tệp của tenant trong token.
    file_id       uuid NOT NULL REFERENCES core.files (id) ON DELETE RESTRICT,
    note          text CHECK (length(note) <= 500),
    -- sub trong token của người đính kèm, do quyền thêm dòng đặt (set), trình duyệt không gửi.
    created_by    text NOT NULL CHECK (created_by <> ''),
    created_at    timestamptz NOT NULL DEFAULT now(),
    -- CASCADE: không ai xóa được dòng nối (không có quyền xóa), nên xóa phiếu kéo theo; tệp vẫn ở core.files và nhật
    -- ký giữ dòng đã xóa.
    FOREIGN KEY (tenant_id, work_order_id)
        REFERENCES app_field_ops.work_orders (tenant_id, id) ON DELETE CASCADE,
    UNIQUE (tenant_id, work_order_id, file_id)
);

SELECT core.audit_attach('app_field_ops.work_orders');
SELECT core.audit_attach('app_field_ops.work_order_documents');
SELECT platform.row_version_attach('app_field_ops.work_orders');

-- Số phiếu của cả tenant, mỗi tenant một dòng kể cả khi chưa có phiếu nào, để thẻ số hiện 0 thay vì "chưa có dữ
-- liệu". Còn mở là chưa xong và chưa hủy; quá hạn là còn mở mà hạn trước ngày hôm nay theo giờ của CSDL.
CREATE VIEW app_field_ops.work_order_summary AS
SELECT t.id AS tenant_id,
       count(w.id) FILTER (WHERE w.status IN ('open', 'in_progress'))::integer AS open_count,
       count(w.id) FILTER (WHERE w.status IN ('open', 'in_progress') AND w.due_on < current_date)::integer
           AS overdue_count,
       count(w.id) FILTER (WHERE w.status = 'done')::integer AS done_count
FROM core.tenants t
LEFT JOIN app_field_ops.work_orders w ON w.tenant_id = t.id
GROUP BY t.id;

-- Phiếu còn mở theo loại việc, mỗi tenant đủ bốn dòng; cùng định nghĩa "còn mở", "quá hạn" như view trên.
CREATE VIEW app_field_ops.work_orders_by_kind AS
SELECT t.id AS tenant_id, k.kind,
       count(w.id) FILTER (WHERE w.status IN ('open', 'in_progress'))::integer AS open_count,
       count(w.id) FILTER (WHERE w.status IN ('open', 'in_progress') AND w.due_on < current_date)::integer
           AS overdue_count
FROM core.tenants t
CROSS JOIN (VALUES ('survey'), ('install'), ('acceptance'), ('repair')) AS k (kind)
LEFT JOIN app_field_ops.work_orders w ON w.tenant_id = t.id AND w.kind = k.kind
GROUP BY t.id, k.kind;

-- migrate:down
DROP VIEW app_field_ops.work_orders_by_kind;
DROP VIEW app_field_ops.work_order_summary;
DROP TABLE app_field_ops.work_order_documents;
DROP TABLE app_field_ops.work_orders;
