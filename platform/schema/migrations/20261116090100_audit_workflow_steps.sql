-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Ghi nhật ký thay đổi cho khai báo bước (ADR 0009). Nằm ở lịch sử migration của Tầng 2 vì bảng thuộc Tầng 2;
-- hàm core.audit_row() đã có từ migration của lõi, chạy trước.

-- migrate:up
SELECT core.audit_attach('platform.workflow_steps');

-- migrate:down
SELECT core.audit_detach('platform.workflow_steps');
