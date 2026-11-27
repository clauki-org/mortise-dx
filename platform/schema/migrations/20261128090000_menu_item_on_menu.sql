-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Khối của trang (mục `blocks` trong app.yaml, ADR 0061) là một dòng menu_items như mục menu, để trang tìm nó theo
-- cùng (app, item), cùng lọc vai trò và cùng quyền đọc. Cột on_menu tách hai loại: khung giao diện chỉ đưa dòng
-- on_menu lên thanh bên và trang chủ; dòng của khối vẫn mở được theo địa chỉ riêng, ví dụ khi bấm một dòng trong khối
-- danh mục.

-- migrate:up
ALTER TABLE platform.menu_items
    -- Mặc định true: dòng nạp trước migration này đều là mục menu, giữ nguyên chỗ trên menu.
    ADD COLUMN on_menu boolean NOT NULL DEFAULT true;

-- migrate:down
ALTER TABLE platform.menu_items DROP COLUMN on_menu;
