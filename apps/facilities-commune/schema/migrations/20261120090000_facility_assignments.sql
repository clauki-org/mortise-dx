-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Phân công cán bộ theo cơ sở: ai phụ trách cơ sở nào. Đây là dữ liệu do xã tự sửa (vai trò tenant_admin qua
-- Hasura); luật "chỉ thấy và sửa cơ sở mình được phân công" nằm trong hasura/tables.yaml và chỉ đổi qua pull
-- request (ADR 0015). Bảng chỉ lưu sub của tài khoản Keycloak, không lưu tên hay email.

-- migrate:up
CREATE TABLE app_facilities_commune.facility_assignments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   text NOT NULL,
    facility_id uuid NOT NULL,
    -- sub trong token của cán bộ (Hasura đặt vào X-Hasura-User-Id); quyền so cột này với token của người gọi.
    user_id     text NOT NULL CHECK (user_id <> ''),
    -- custodian: phụ trách cơ sở, thấy và sửa cơ sở, tòa, phòng. approver: được duyệt hồ sơ của cơ sở, chỉ thấy
    -- dữ liệu; workflow-api chưa đọc bảng này nên hiện người duyệt vẫn được xét theo vai trò (ADR 0015).
    duty        text NOT NULL CHECK (duty IN ('custodian', 'approver')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- Khóa ngoại ghép: không phân công được vào cơ sở của xã khác dù lớp API có lọt. CASCADE khác RESTRICT của
    -- tòa, phòng: phân công không phải hồ sơ tài sản, và cơ sở chỉ xóa được khi đã hết tòa nên không mất gì.
    FOREIGN KEY (tenant_id, facility_id)
        REFERENCES app_facilities_commune.facilities (tenant_id, id) ON DELETE CASCADE,
    UNIQUE (tenant_id, facility_id, user_id, duty)
);

-- Quyền của vai trò user tra "có phân công của tôi ở cơ sở này không" trên mỗi dòng cơ sở, tòa, phòng; chỉ mục
-- của UNIQUE ở trên bắt đầu bằng (tenant_id, facility_id) nên dùng được cho việc đó.

-- tenant_admin sửa bảng này qua Hasura, nên mọi thay đổi phân công có nhật ký (ADR 0009).
SELECT core.audit_attach('app_facilities_commune.facility_assignments');

-- migrate:down
DROP TABLE app_facilities_commune.facility_assignments;
