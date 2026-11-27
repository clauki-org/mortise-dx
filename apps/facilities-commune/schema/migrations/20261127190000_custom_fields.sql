-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Trường tùy chỉnh cho cơ sở và phòng (ADR 0059): quản trị org định nghĩa trường ở platform.custom_fields, giá trị nằm
-- trong cột `custom`, trigger của nền tảng kiểm theo định nghĩa. Cột `custom` có trong quyền đọc, ghi ở
-- hasura/tables.yaml.

-- migrate:up
SELECT platform.custom_fields_attach('app_facilities_commune.facilities', 'facilities-commune');
SELECT platform.custom_fields_attach('app_facilities_commune.rooms', 'facilities-commune');

-- migrate:down
-- Xóa cả định nghĩa trường của hai bảng (có nhật ký) cùng giá trị đã nhập.
SELECT platform.custom_fields_detach('app_facilities_commune.rooms');
SELECT platform.custom_fields_detach('app_facilities_commune.facilities');
