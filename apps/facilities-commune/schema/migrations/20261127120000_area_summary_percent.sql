-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Phần trăm diện tích đang dùng so với diện tích được phép của cả xã, cho vòng đo của khối chính trên bảng điều hành
-- (dashboards/overview.yaml, ADR 0049). Thành phần bảng điều hành không chia số trên trình duyệt (ADR 0033), nên phần
-- trăm là một cột của area_summary, cạnh hai số mà nó so. Chỉ đọc, không có dữ liệu riêng nên không gắn nhật ký.

-- migrate:up
-- Giữ nguyên câu của 20261119150000_allowed_area.sql, chỉ thêm cột cuối: CREATE OR REPLACE VIEW chỉ cho thêm cột vào
-- cuối, và area_rollup, facility_rollup, area_by_type đọc view này nên không xóa đi tạo lại được. Làm tròn tới hàng
-- đơn vị như số người xem đọc trên vòng đo; xã chưa có diện tích được phép thì không có phần trăm (NULL), vòng đo báo
-- chưa có số liệu thay vì chia cho 0.
CREATE OR REPLACE VIEW app_facilities_commune.area_summary AS
WITH working AS (
    SELECT tenant_id, sum(allowed_m2) AS m2 FROM app_facilities_commune.staffing_allowances GROUP BY tenant_id
), specialized AS (
    SELECT tenant_id, sum(area_m2) AS m2 FROM app_facilities_commune.specialized_allowances GROUP BY tenant_id
), actual AS (
    SELECT r.tenant_id,
           sum(r.clear_area_m2) FILTER (WHERE f.status = 'in_use') AS in_use_m2,
           sum(r.clear_area_m2) FILTER (WHERE f.status = 'surplus') AS surplus_m2
    FROM app_facilities_commune.rooms r
    JOIN app_facilities_commune.buildings b ON b.tenant_id = r.tenant_id AND b.id = r.building_id
    JOIN app_facilities_commune.facilities f ON f.tenant_id = b.tenant_id AND f.id = b.facility_id
    GROUP BY r.tenant_id
), totals AS (
    SELECT t.id AS tenant_id,
           coalesce(w.m2, 0) AS working_allowed_m2,
           coalesce(w.m2, 0) AS shared_allowed_m2,
           coalesce(s.m2, 0) AS specialized_allowed_m2,
           coalesce(a.in_use_m2, 0) AS in_use_m2,
           coalesce(a.surplus_m2, 0) AS surplus_m2
    FROM core.tenants t
    LEFT JOIN working w ON w.tenant_id = t.id
    LEFT JOIN specialized s ON s.tenant_id = t.id
    LEFT JOIN actual a ON a.tenant_id = t.id
)
SELECT tenant_id, working_allowed_m2, shared_allowed_m2, specialized_allowed_m2,
       working_allowed_m2 + shared_allowed_m2 + specialized_allowed_m2 AS allowed_m2,
       in_use_m2, surplus_m2,
       greatest(in_use_m2 - (working_allowed_m2 + shared_allowed_m2 + specialized_allowed_m2), 0) AS excess_m2,
       round(100 * in_use_m2 / nullif(working_allowed_m2 + shared_allowed_m2 + specialized_allowed_m2, 0))
           AS in_use_percent
FROM totals;

-- migrate:down
-- Postgres không bỏ được cột của view, nên xóa các view đọc area_summary, tạo lại area_summary như trước rồi tạo lại
-- chúng, mỗi câu chép nguyên từ migration gốc.
DROP VIEW app_facilities_commune.area_by_type;
DROP VIEW app_facilities_commune.facility_rollup;
DROP VIEW app_facilities_commune.area_rollup;
DROP VIEW app_facilities_commune.area_summary;
CREATE VIEW app_facilities_commune.area_summary AS
WITH working AS (
    SELECT tenant_id, sum(allowed_m2) AS m2 FROM app_facilities_commune.staffing_allowances GROUP BY tenant_id
), specialized AS (
    SELECT tenant_id, sum(area_m2) AS m2 FROM app_facilities_commune.specialized_allowances GROUP BY tenant_id
), actual AS (
    SELECT r.tenant_id,
           sum(r.clear_area_m2) FILTER (WHERE f.status = 'in_use') AS in_use_m2,
           sum(r.clear_area_m2) FILTER (WHERE f.status = 'surplus') AS surplus_m2
    FROM app_facilities_commune.rooms r
    JOIN app_facilities_commune.buildings b ON b.tenant_id = r.tenant_id AND b.id = r.building_id
    JOIN app_facilities_commune.facilities f ON f.tenant_id = b.tenant_id AND f.id = b.facility_id
    GROUP BY r.tenant_id
), totals AS (
    SELECT t.id AS tenant_id,
           coalesce(w.m2, 0) AS working_allowed_m2,
           coalesce(w.m2, 0) AS shared_allowed_m2,
           coalesce(s.m2, 0) AS specialized_allowed_m2,
           coalesce(a.in_use_m2, 0) AS in_use_m2,
           coalesce(a.surplus_m2, 0) AS surplus_m2
    FROM core.tenants t
    LEFT JOIN working w ON w.tenant_id = t.id
    LEFT JOIN specialized s ON s.tenant_id = t.id
    LEFT JOIN actual a ON a.tenant_id = t.id
)
SELECT tenant_id, working_allowed_m2, shared_allowed_m2, specialized_allowed_m2,
       working_allowed_m2 + shared_allowed_m2 + specialized_allowed_m2 AS allowed_m2,
       in_use_m2, surplus_m2,
       greatest(in_use_m2 - (working_allowed_m2 + shared_allowed_m2 + specialized_allowed_m2), 0) AS excess_m2
FROM totals;

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

CREATE VIEW app_facilities_commune.facility_rollup AS
SELECT t.parent_id AS parent_tenant_id,
       f.tenant_id,
       t.name AS tenant_name,
       f.code,
       f.name,
       f.latitude,
       f.longitude,
       s.excess_m2
FROM app_facilities_commune.facilities f
JOIN core.tenants t ON t.id = f.tenant_id
JOIN app_facilities_commune.area_summary s ON s.tenant_id = f.tenant_id
WHERE t.parent_id IS NOT NULL AND f.status = 'in_use';

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
