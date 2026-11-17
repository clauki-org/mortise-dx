-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Migration đầu tiên của gói cơ sở vật chất xã: lược đồ riêng và ba bảng cơ sở → tòa → phòng.
-- Lịch sử migration của gói ghi ở bảng public.facilities_commune_schema_migrations, nằm ngoài
-- lược đồ này: gỡ gói là DROP SCHEMA, nếu bảng theo dõi nằm trong đó thì nó bị xóa giữa lúc gỡ
-- (ADR 0005). Gói không sửa gì trong lược đồ core; chỉ tham chiếu core.tenants để không có dòng
-- nào thuộc một tenant không tồn tại, và gọi core.audit_attach để mọi thay đổi có nhật ký (ADR 0009).

-- migrate:up
CREATE SCHEMA app_facilities_commune;

-- Cơ sở nhà, đất (trụ sở) của một xã. Mỗi dòng thuộc đúng một tenant; một tenant là một xã.
-- status tách hai khái niệm pháp lý khác nhau: trụ sở đang dùng (in_use, có thể vượt tiêu chuẩn,
-- định mức) và cơ sở nhà, đất dôi dư (surplus, không còn dùng). Phần vượt chỉ tính trên in_use.
CREATE TABLE app_facilities_commune.facilities (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  text NOT NULL REFERENCES core.tenants (id) ON DELETE RESTRICT,
    code       text NOT NULL,
    name       text NOT NULL,
    address    text,
    status     text NOT NULL DEFAULT 'in_use' CHECK (status IN ('in_use', 'surplus')),
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Đích cho khóa ngoại ghép của bảng con: con phải cùng tenant với cha, CSDL tự chặn việc
    -- trỏ sang cơ sở của xã khác dù lớp API có lọt.
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code)
);

-- Tòa nhà trong một cơ sở.
CREATE TABLE app_facilities_commune.buildings (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   text NOT NULL,
    facility_id uuid NOT NULL,
    code        text NOT NULL,
    name        text NOT NULL,
    floors      integer CHECK (floors > 0),
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- RESTRICT: xóa cơ sở còn tòa phải bị từ chối; hồ sơ tài sản công không được mất dây chuyền.
    FOREIGN KEY (tenant_id, facility_id)
        REFERENCES app_facilities_commune.facilities (tenant_id, id) ON DELETE RESTRICT,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, facility_id, code)
);

-- Phòng là đơn vị đo diện tích. clear_area_m2 là diện tích thông thủy (đo lọt lòng), vì tiêu
-- chuẩn, định mức tính theo thông thủy, không theo diện tích sàn. area_type là loại diện tích
-- dùng khi tính diện tích được phép: working (làm việc, theo chức danh và biên chế), shared
-- (sử dụng chung: phòng họp, một cửa, kho; tối đa bằng working), specialized (chuyên dùng,
-- do tỉnh quyết định).
CREATE TABLE app_facilities_commune.rooms (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     text NOT NULL,
    building_id   uuid NOT NULL,
    code          text NOT NULL,
    name          text NOT NULL,
    floor         integer,
    area_type     text NOT NULL CHECK (area_type IN ('working', 'shared', 'specialized')),
    clear_area_m2 numeric(10, 2) NOT NULL CHECK (clear_area_m2 > 0),
    created_at    timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, building_id)
        REFERENCES app_facilities_commune.buildings (tenant_id, id) ON DELETE RESTRICT,
    UNIQUE (tenant_id, building_id, code)
);

-- Hasura thêm điều kiện tenant vào mọi truy vấn và khóa ngoại ghép tra con theo (tenant_id, cha): chỉ mục của
-- UNIQUE (tenant_id, facility_id, code) và UNIQUE (tenant_id, building_id, code) bắt đầu bằng đúng hai cột đó nên
-- dùng được cho cả hai việc, không cần chỉ mục riêng.

-- Người dùng sửa được ba bảng này qua Hasura, nên mọi thay đổi phải để lại nhật ký (ADR 0009).
SELECT core.audit_attach('app_facilities_commune.facilities');
SELECT core.audit_attach('app_facilities_commune.buildings');
SELECT core.audit_attach('app_facilities_commune.rooms');

-- migrate:down
-- CASCADE xóa bảng cùng trigger nhật ký gắn trên chúng; dòng đã ghi trong core.audit_log vẫn còn.
-- Bảng của lõi và gói khác không bị đụng.
DROP SCHEMA app_facilities_commune CASCADE;
