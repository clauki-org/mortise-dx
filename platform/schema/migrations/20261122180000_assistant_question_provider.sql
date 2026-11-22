-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Nhật ký câu hỏi ghi thêm câu hỏi đi tới nhà cung cấp mô hình nào (bổ sung của ADR 0021): `ollama` chạy tại chỗ, hay
-- `openai-compatible` cùng tên máy của API mà câu hỏi và các câu đã tìm được gửi tới. Hai cột cho phép null vì dòng ghi
-- trước migration này không có giá trị; lúc đó trợ lý chỉ gọi Ollama.

-- migrate:up
ALTER TABLE platform.assistant_questions
    ADD COLUMN model_provider text,
    -- null khi chạy tại chỗ.
    ADD COLUMN model_host text;

-- migrate:down
ALTER TABLE platform.assistant_questions
    DROP COLUMN model_host,
    DROP COLUMN model_provider;
