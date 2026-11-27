-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Migration đầu tiên của gói vận hành hiện trường: lược đồ riêng, khách hàng, điểm lắp đặt và thiết bị tại điểm. Bảng
-- theo dõi migration nằm ngoài lược đồ này (public.field_ops_schema_migrations, ADR 0005). Gói chỉ gồm khai báo (ADR
-- 0022): nhật ký qua core.audit_attach của lõi (ADR 0009), cột sửa cuối qua platform.row_version_attach (ADR 0067).
-- Bảng con nối về bảng cha bằng mã, không bằng id, để dữ liệu demo và cấu hình danh mục không phải biết id sinh tự
-- động; khóa ngoại ghép kèm tenant_id chặn việc nối vào dòng của tenant khác dù lớp API có lọt.

-- migrate:up
CREATE SCHEMA app_field_ops;

CREATE TABLE app_field_ops.customers (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  text NOT NULL REFERENCES core.tenants (id) ON DELETE RESTRICT,
    code       text NOT NULL CHECK (code <> ''),
    name       text NOT NULL CHECK (name <> ''),
    phone      text CHECK (length(phone) <= 30),
    address    text CHECK (length(address) <= 500),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);

-- Điểm lắp đặt của một khách hàng. Tọa độ là hai cột số như cơ sở của gói xã (ADR 0020): có cả hai hoặc trống cả hai,
-- bản đồ bỏ qua điểm chưa có tọa độ. status là giai đoạn của điểm, do người dùng đổi; luật ngưỡng không đổi nó.
CREATE TABLE app_field_ops.sites (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     text NOT NULL,
    customer_code text NOT NULL,
    code          text NOT NULL CHECK (code <> ''),
    name          text NOT NULL CHECK (name <> ''),
    address       text CHECK (length(address) <= 500),
    latitude      numeric(8, 6) CHECK (latitude BETWEEN -90 AND 90),
    longitude     numeric(9, 6) CHECK (longitude BETWEEN -180 AND 180),
    capacity_kwp  numeric(10, 2) CHECK (capacity_kwp > 0),
    status        text NOT NULL DEFAULT 'survey'
                  CHECK (status IN ('survey', 'installing', 'operating', 'needs_repair')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sites_location_pair CHECK ((latitude IS NULL) = (longitude IS NULL)),
    -- RESTRICT: xóa khách hàng còn điểm lắp đặt bị từ chối, không mất điểm theo dây chuyền.
    FOREIGN KEY (tenant_id, customer_code)
        REFERENCES app_field_ops.customers (tenant_id, code) ON DELETE RESTRICT,
    UNIQUE (tenant_id, code)
);

-- Thiết bị tại một điểm. device_name là tên thiết bị trên MQTT (chủ đề mortise/<tenant>/<tên>, ADR 0012), cũng là
-- phần cuối của mã entity urn:ngsi-ld:Device:<tên> mà context-api trả và biến device của hồ sơ do luật ngưỡng mở;
-- duy nhất trong tenant để từ hồ sơ tìm ra đúng một thiết bị. Thiết bị không gửi số đo (tấm pin) thì để trống.
CREATE TABLE app_field_ops.devices (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   text NOT NULL,
    site_code   text NOT NULL,
    code        text NOT NULL CHECK (code <> ''),
    kind        text NOT NULL CHECK (kind IN ('meter', 'inverter', 'panel')),
    model       text CHECK (length(model) <= 200),
    device_name text CHECK (device_name ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, site_code) REFERENCES app_field_ops.sites (tenant_id, code) ON DELETE RESTRICT,
    UNIQUE (tenant_id, site_code, code),
    UNIQUE (tenant_id, device_name)
);

SELECT core.audit_attach('app_field_ops.customers');
SELECT core.audit_attach('app_field_ops.sites');
SELECT core.audit_attach('app_field_ops.devices');
SELECT platform.row_version_attach('app_field_ops.customers');
SELECT platform.row_version_attach('app_field_ops.sites');
SELECT platform.row_version_attach('app_field_ops.devices');

-- migrate:down
-- CASCADE xóa bảng cùng phần nhật ký và cột sửa cuối gắn trên chúng; dòng đã ghi trong core.audit_log vẫn còn.
DROP SCHEMA app_field_ops CASCADE;
