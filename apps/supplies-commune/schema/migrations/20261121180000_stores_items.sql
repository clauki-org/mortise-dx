-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Migration đầu tiên của gói kho vật tư xã: lược đồ riêng, bảng kho và bảng vật tư trong kho. Bảng theo dõi
-- migration nằm ngoài lược đồ này (public.supplies_commune_schema_migrations, ADR 0005). Gói chỉ gồm khai báo
-- (ADR 0022): không có hàm hay trigger riêng; nhật ký thay đổi dùng core.audit_attach của lõi (ADR 0009).

-- migrate:up
CREATE SCHEMA app_supplies_commune;

-- Kho của một xã. Mã kho là khóa mà bảng vật tư trỏ tới, để dữ liệu demo và cấu hình danh mục nối kho với vật tư
-- bằng mã thay vì id sinh tự động.
CREATE TABLE app_supplies_commune.stores (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  text NOT NULL REFERENCES core.tenants (id) ON DELETE RESTRICT,
    code       text NOT NULL CHECK (code <> ''),
    name       text NOT NULL,
    location   text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);

-- Vật tư, thiết bị trong một kho. kind tách hàng dùng hết (consumable) với thiết bị dùng lâu (equipment), để lọc
-- riêng khi kiểm kê. quantity là số đang có theo lần kiểm kê gần nhất; gói không có mã nên không tự trừ khi xuất kho.
CREATE TABLE app_supplies_commune.items (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  text NOT NULL,
    store_code text NOT NULL,
    code       text NOT NULL CHECK (code <> ''),
    name       text NOT NULL,
    unit       text NOT NULL,
    kind       text NOT NULL CHECK (kind IN ('consumable', 'equipment')),
    quantity   numeric(12, 2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Khóa ngoại ghép kèm tenant_id: CSDL tự chặn việc đặt vật tư vào kho của xã khác dù lớp API có lọt. RESTRICT:
    -- xóa kho còn vật tư bị từ chối, không mất hồ sơ vật tư theo dây chuyền.
    FOREIGN KEY (tenant_id, store_code)
        REFERENCES app_supplies_commune.stores (tenant_id, code) ON DELETE RESTRICT,
    UNIQUE (tenant_id, store_code, code)
);

-- Quản trị xã sửa hai bảng này qua Hasura, nên mọi thay đổi để lại nhật ký (ADR 0009).
SELECT core.audit_attach('app_supplies_commune.stores');
SELECT core.audit_attach('app_supplies_commune.items');

-- migrate:down
-- CASCADE xóa bảng cùng phần nhật ký gắn trên chúng; dòng đã ghi trong core.audit_log vẫn còn.
DROP SCHEMA app_supplies_commune CASCADE;
