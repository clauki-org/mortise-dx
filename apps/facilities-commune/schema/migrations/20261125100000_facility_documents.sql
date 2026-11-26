-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Giấy tờ đính kèm cơ sở (biên bản, ảnh, quyết định): mỗi dòng nối một cơ sở với một tệp đã tải lên qua API tệp của
-- lõi (/v1/files, core.files). Nội dung, tên, cỡ của tệp nằm ở lõi; bảng này chỉ giữ việc tệp thuộc cơ sở nào, ai
-- đính kèm, lúc nào. Ai thấy, ai thêm được dòng nằm trong hasura/tables.yaml; thành phần danh mục hiện các dòng này
-- trên màn hình chi tiết cơ sở theo detail.documents của catalog/facilities.yaml (ADR 0041).

-- migrate:up
CREATE TABLE app_facilities_commune.facility_documents (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   text NOT NULL,
    facility_id uuid NOT NULL,
    -- Khóa ngoại một cột: core.files không có UNIQUE (tenant_id, id) nên không ghép được với tenant, và gói không
    -- sửa lược đồ core. Tệp của xã khác gắn vào đây cũng không mở được: files-api chỉ trả tệp của tenant trong token.
    file_id     uuid NOT NULL REFERENCES core.files (id) ON DELETE RESTRICT,
    note        text CHECK (length(note) <= 500),
    -- sub trong token của người đính kèm, do quyền thêm dòng đặt (set), trình duyệt không gửi.
    created_by  text NOT NULL CHECK (created_by <> ''),
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- Khóa ngoại ghép như tòa và phân công: không gắn được tệp vào cơ sở của xã khác dù lớp API có lọt. CASCADE như
    -- phân công: không ai xóa được dòng nối (không có quyền xóa), nên xóa cơ sở phải kéo theo; cơ sở chỉ xóa được khi
    -- đã hết tòa, tệp vẫn còn ở core.files và nhật ký giữ dòng đã xóa.
    FOREIGN KEY (tenant_id, facility_id)
        REFERENCES app_facilities_commune.facilities (tenant_id, id) ON DELETE CASCADE,
    -- Một tệp gắn một lần vào một cơ sở; gửi lại cùng lệnh thêm dòng sau khi mất phản hồi không tạo dòng thứ hai.
    UNIQUE (tenant_id, facility_id, file_id)
);

-- Người dùng thêm dòng qua Hasura, nên mọi thay đổi phải để lại nhật ký (ADR 0009).
SELECT core.audit_attach('app_facilities_commune.facility_documents');

-- migrate:down
DROP TABLE app_facilities_commune.facility_documents;
