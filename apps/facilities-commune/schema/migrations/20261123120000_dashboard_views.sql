-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Ba view cho bảng điều hành của gói (dashboards/overview.yaml, ADR 0033). Thành phần bảng điều hành không cộng hay
-- đếm gì trên trình duyệt, nên mỗi con số trên trang là một cột tính ở đây. Mỗi view có một dòng cho mọi tenant (hay
-- mọi cặp tenant và nhóm), kể cả khi chưa có dữ liệu: thẻ số cần đúng một dòng, thiếu dòng thì trang báo chưa có số
-- liệu thay vì 0. Chỉ đọc, không có dữ liệu riêng nên không gắn nhật ký.

-- migrate:up
-- Số cơ sở và tổng diện tích thông thủy theo trạng thái. Diện tích của in_use bằng in_use_m2 của area_summary, của
-- surplus bằng surplus_m2.
CREATE VIEW app_facilities_commune.facility_status_counts AS
WITH facility_area AS (
    SELECT b.tenant_id, b.facility_id, sum(r.clear_area_m2) AS m2
    FROM app_facilities_commune.rooms r
    JOIN app_facilities_commune.buildings b ON b.tenant_id = r.tenant_id AND b.id = r.building_id
    GROUP BY b.tenant_id, b.facility_id
)
SELECT t.id AS tenant_id, s.status, count(f.id)::integer AS facility_count, coalesce(sum(a.m2), 0) AS clear_area_m2
FROM core.tenants t
CROSS JOIN (VALUES ('in_use'), ('surplus')) AS s (status)
LEFT JOIN app_facilities_commune.facilities f ON f.tenant_id = t.id AND f.status = s.status
LEFT JOIN facility_area a ON a.tenant_id = f.tenant_id AND a.facility_id = f.id
GROUP BY t.id, s.status;

-- Diện tích đang dùng và được phép theo loại diện tích, chỉ để đối chiếu: phần vượt theo luật tính trên tổng của cả
-- xã (area_summary), không theo từng loại. Được phép lấy nguyên cột của area_summary để hai nơi không lệch nhau.
CREATE VIEW app_facilities_commune.area_by_type AS
WITH used AS (
    SELECT r.tenant_id, r.area_type, sum(r.clear_area_m2) AS m2
    FROM app_facilities_commune.rooms r
    JOIN app_facilities_commune.buildings b ON b.tenant_id = r.tenant_id AND b.id = r.building_id
    JOIN app_facilities_commune.facilities f ON f.tenant_id = b.tenant_id AND f.id = b.facility_id
    WHERE f.status = 'in_use'
    GROUP BY r.tenant_id, r.area_type
)
SELECT s.tenant_id, k.area_type, coalesce(u.m2, 0) AS in_use_m2,
       CASE k.area_type
           WHEN 'working' THEN s.working_allowed_m2
           WHEN 'shared' THEN s.shared_allowed_m2
           ELSE s.specialized_allowed_m2
       END AS allowed_m2
FROM app_facilities_commune.area_summary s
CROSS JOIN (VALUES ('working'), ('shared'), ('specialized')) AS k (area_type)
LEFT JOIN used u ON u.tenant_id = s.tenant_id AND u.area_type = k.area_type;

-- Số cơ sở (cả đang dùng và dôi dư) chưa có ai phụ trách hay chưa có người duyệt trong bảng phân công. Lộ ra cơ sở
-- nào không ai trông coi, nên chỉ lãnh đạo và quản trị xã đọc (hasura/tables.yaml).
CREATE VIEW app_facilities_commune.facility_coverage AS
SELECT t.id AS tenant_id,
       count(f.id)::integer AS facility_count,
       count(f.id) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM app_facilities_commune.facility_assignments a
           WHERE a.tenant_id = f.tenant_id AND a.facility_id = f.id AND a.duty = 'custodian'))::integer
           AS without_custodian,
       count(f.id) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM app_facilities_commune.facility_assignments a
           WHERE a.tenant_id = f.tenant_id AND a.facility_id = f.id AND a.duty = 'approver'))::integer
           AS without_approver
FROM core.tenants t
LEFT JOIN app_facilities_commune.facilities f ON f.tenant_id = t.id
GROUP BY t.id;

-- migrate:down
DROP VIEW app_facilities_commune.facility_coverage;
DROP VIEW app_facilities_commune.area_by_type;
DROP VIEW app_facilities_commune.facility_status_counts;
