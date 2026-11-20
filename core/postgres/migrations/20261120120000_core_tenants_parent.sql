-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Quan hệ cha–con giữa các tenant (ADR 0016). Lõi không biết tenant là tỉnh, xã hay chi nhánh: chỉ biết một tenant
-- có thể có cha. Gói dựa vào cột này để cho tenant cha đọc số liệu tổng hợp của các tenant con, qua view của gói và
-- vai trò rollup_reader, không đọc được dữ liệu gốc.

-- migrate:up
-- parent_id là một cạnh phân quyền: ai đặt được cột này thì cho một tenant đọc tổng hợp của tenant khác. Vì vậy
-- không vai trò Hasura nào được ghi nó; chỉ seed hay người vận hành sửa trong CSDL. RESTRICT: xóa tenant cha còn con
-- phải bị từ chối, không để tenant con mất cha lặng lẽ.
ALTER TABLE core.tenants
    ADD COLUMN parent_id text REFERENCES core.tenants (id) ON DELETE RESTRICT,
    ADD CONSTRAINT tenants_parent_not_self CHECK (parent_id <> id);

-- migrate:down
ALTER TABLE core.tenants DROP COLUMN parent_id;
