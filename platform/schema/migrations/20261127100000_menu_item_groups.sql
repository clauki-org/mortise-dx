-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Mục menu mang thêm tên nhóm và ý nghĩa biểu tượng (ADR 0044): khung giao diện gom mục theo gói dưới tên hiển thị
-- của gói (`name` trong app.yaml, hay `name` của scripts/core-menu.yaml với mục mẫu của lõi) và vẽ biểu tượng theo
-- `icon` của mục. Trình duyệt chỉ đọc được bảng này, không đọc được app.yaml, nên tên gói phải nằm trong dòng.

-- migrate:up
ALTER TABLE platform.menu_items
    -- NULL với dòng nạp trước migration này, tới khi chạy lại `make seed` hay cài lại gói; giao diện lấy mã gói
    -- làm tên nhóm trong lúc đó.
    ADD COLUMN app_name text,
    -- Một ý nghĩa trong danh mục của contracts/app.schema.json; NULL là mục không khai biểu tượng.
    ADD COLUMN icon text;

-- migrate:down
ALTER TABLE platform.menu_items
    DROP COLUMN icon,
    DROP COLUMN app_name;
