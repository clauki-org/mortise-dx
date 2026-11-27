-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Trường tùy chỉnh cho vật tư (ADR 0059): gói khai báo không tự viết trigger (ADR 0022), nên gọi hàm có sẵn của nền
-- tảng; hàm thêm cột `custom` và trigger kiểm giá trị theo định nghĩa của quản trị org. Cột `custom` có trong quyền
-- đọc, ghi ở hasura/tables.yaml.

-- migrate:up
SELECT platform.custom_fields_attach('app_supplies_commune.items', 'supplies-commune');

-- migrate:down
-- Xóa cả định nghĩa trường của bảng (có nhật ký) cùng giá trị đã nhập.
SELECT platform.custom_fields_detach('app_supplies_commune.items');
