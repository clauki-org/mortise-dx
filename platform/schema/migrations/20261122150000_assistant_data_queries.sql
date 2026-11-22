-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Nhật ký câu hỏi cũng ghi câu hỏi dữ liệu (ADR 0027): câu GraphQL đã chạy hay bị guard từ chối, số dòng trả về và số
-- lượt mô hình viết câu. Không có cột nào cho dòng kết quả: dữ liệu người hỏi xem đã có ở bảng nguồn với quyền của
-- nó, chép vào nhật ký thì quản trị đọc nhật ký thấy cả dòng mà họ không có quyền ở bảng nguồn. Câu hỏi dữ liệu ghi
-- `documents` rỗng, kết quả `answered` khi chạy được; `query` có giá trị là dấu hiệu của câu hỏi dữ liệu. Câu mẫu của
-- gói chạy không qua mô hình, nên `model` và `attempts` trống ở các dòng đó; câu hỏi văn bản vẫn luôn có mô hình.

-- migrate:up
ALTER TABLE platform.assistant_questions
    ADD COLUMN query text,
    ADD COLUMN row_count integer CHECK (row_count >= 0),
    ADD COLUMN attempts smallint CHECK (attempts >= 1),
    ALTER COLUMN model DROP NOT NULL,
    ADD CONSTRAINT assistant_questions_model_or_query CHECK (model IS NOT NULL OR query IS NOT NULL),
    ADD CONSTRAINT assistant_questions_rows_need_query CHECK (row_count IS NULL OR query IS NOT NULL);

-- migrate:down
-- Không chạy được khi đã có dòng câu hỏi dữ liệu (model trống): nhật ký có chuỗi băm, nên không xóa dòng để lùi.
ALTER TABLE platform.assistant_questions
    DROP CONSTRAINT assistant_questions_rows_need_query,
    DROP CONSTRAINT assistant_questions_model_or_query,
    ALTER COLUMN model SET NOT NULL,
    DROP COLUMN attempts,
    DROP COLUMN row_count,
    DROP COLUMN query;
