-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Tổng hợp diện tích cho tenant cha (ADR 0016): mỗi tenant con một dòng, lấy nguyên số của area_summary để tỉnh và
-- xã luôn thấy cùng một con số, không tính lại. Vai trò rollup_reader chỉ đọc view này, lọc theo parent_tenant_id;
-- không có quyền ở bảng cơ sở, tòa, phòng, nên tỉnh thấy số tổng mà không thấy dữ liệu gốc của xã.

-- migrate:up
-- Chỉ tenant có cha: area_summary có một dòng cho mọi tenant, kể cả chính tenant cha. Thêm cột vào view này là mở
-- thêm dữ liệu cho tenant cha, nên phải review như đổi quyền.
CREATE VIEW app_facilities_commune.area_rollup AS
SELECT t.parent_id AS parent_tenant_id,
       s.tenant_id,
       t.name AS tenant_name,
       s.allowed_m2,
       s.in_use_m2,
       s.surplus_m2,
       s.excess_m2
FROM app_facilities_commune.area_summary s
JOIN core.tenants t ON t.id = s.tenant_id
WHERE t.parent_id IS NOT NULL;

-- migrate:down
DROP VIEW app_facilities_commune.area_rollup;
