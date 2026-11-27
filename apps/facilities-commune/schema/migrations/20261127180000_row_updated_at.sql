-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Thời điểm sửa cuối của cơ sở, tòa, phòng, để biểu mẫu sửa trên danh mục phát hiện hai người sửa cùng một dòng (ADR
-- 0054): biểu mẫu đọc updated_at lúc mở và đặt nó vào where của lệnh update; người khác đã sửa trước thì giá trị đã
-- đổi, lệnh không khớp dòng nào và người sửa sau được báo thay vì ghi đè. Nhật ký (core.audit_attach ở
-- 20261114171921_facilities_buildings_rooms.sql) là trigger AFTER nên ghi cả giá trị mới của cột này.

-- migrate:up
-- NOT NULL với mặc định now(): dòng đã có nhận giờ lúc chạy migration. Cột trống thì điều kiện so trong where không
-- dùng được (Hasura không nhận _eq: null), và dòng đó sửa được mà không ai biết đã có người sửa trước.
ALTER TABLE app_facilities_commune.facilities ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE app_facilities_commune.buildings ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE app_facilities_commune.rooms ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Giờ do máy chủ đặt ở mọi lệnh UPDATE, kể cả lệnh không đi qua biểu mẫu: quyền Hasura không cho ghi cột này, và nếu
-- chỉ trình duyệt đặt thì một lệnh sửa từ nơi khác giữ nguyên giá trị cũ, biểu mẫu đang mở sẽ ghi đè mà không báo.
-- clock_timestamp() thay vì now(): hai lệnh sửa cùng dòng trong một giao dịch vẫn ra hai giá trị khác nhau.
CREATE FUNCTION app_facilities_commune.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END
$$;

CREATE TRIGGER touch_updated_at BEFORE UPDATE ON app_facilities_commune.facilities
    FOR EACH ROW EXECUTE FUNCTION app_facilities_commune.touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON app_facilities_commune.buildings
    FOR EACH ROW EXECUTE FUNCTION app_facilities_commune.touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON app_facilities_commune.rooms
    FOR EACH ROW EXECUTE FUNCTION app_facilities_commune.touch_updated_at();

-- migrate:down
DROP TRIGGER touch_updated_at ON app_facilities_commune.rooms;
DROP TRIGGER touch_updated_at ON app_facilities_commune.buildings;
DROP TRIGGER touch_updated_at ON app_facilities_commune.facilities;
DROP FUNCTION app_facilities_commune.touch_updated_at();
ALTER TABLE app_facilities_commune.rooms DROP COLUMN updated_at;
ALTER TABLE app_facilities_commune.buildings DROP COLUMN updated_at;
ALTER TABLE app_facilities_commune.facilities DROP COLUMN updated_at;
