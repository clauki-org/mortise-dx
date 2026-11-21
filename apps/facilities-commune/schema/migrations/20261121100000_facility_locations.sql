-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Vị trí của cơ sở để vẽ lên bản đồ, và view cho tenant cha thấy trụ sở đang dùng của các xã con kèm phần vượt của
-- xã (ADR 0020). Tọa độ là hai cột số thường, không dùng PostGIS: image CSDL của lõi là pgvector, không có PostGIS,
-- và gói chỉ cần lưu, đọc một điểm, không tính khoảng cách hay vùng trong CSDL.

-- migrate:up
-- Vĩ độ, kinh độ theo WGS 84 (hệ của GPS và bản đồ web), độ thập phân, sáu chữ số sau dấu phẩy. Bỏ trống khi chưa
-- đo: cơ sở vẫn nhập được trước, bản đồ chỉ bỏ qua nó. Có một mà thiếu một là lỗi nhập, CSDL chặn để bản đồ không
-- phải đoán.
ALTER TABLE app_facilities_commune.facilities
    ADD COLUMN latitude  numeric(8, 6) CHECK (latitude BETWEEN -90 AND 90),
    ADD COLUMN longitude numeric(9, 6) CHECK (longitude BETWEEN -180 AND 180),
    ADD CONSTRAINT facilities_location_pair CHECK ((latitude IS NULL) = (longitude IS NULL));

-- Mỗi cơ sở đang dùng của một xã có tenant cha một dòng: mã, tên, vị trí và phần vượt của cả xã, lấy nguyên từ
-- area_summary để tỉnh và xã thấy cùng một con số. Cơ sở dôi dư không có ở đây vì phần vượt chỉ tính trên cơ sở đang
-- dùng. Không có tòa, phòng, diện tích từng cơ sở hay phân công. Thêm cột vào view này là mở thêm dữ liệu cho tenant
-- cha, nên phải review như đổi quyền (ADR 0016, ADR 0020).
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

-- migrate:down
-- Xóa cột thì ràng buộc trên cột đi theo; trigger nhật ký của bảng không đổi.
DROP VIEW app_facilities_commune.facility_rollup;
ALTER TABLE app_facilities_commune.facilities DROP COLUMN latitude, DROP COLUMN longitude;
