-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Nhật ký câu hỏi của trợ lý hỏi văn bản (ADR 0021): mỗi câu hỏi một dòng, gồm câu trả lời, lý do từ chối hay lỗi và
-- các câu trích. platform/services/assistant ghi bằng vai trò CSDL `assistant` (core/postgres/roles.sh tạo), chỉ được
-- thêm dòng: dịch vụ có bị chiếm cũng không sửa, xóa hay đọc được nhật ký. Người dùng không ghi được qua GraphQL, nên
-- không tự tạo được dòng giả. Quản trị của tenant (tenant_admin) đọc nhật ký của tenant mình qua Hasura.

-- migrate:up
CREATE TABLE platform.assistant_questions (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  text NOT NULL REFERENCES core.tenants (id) ON DELETE CASCADE,
    asked_at   timestamptz NOT NULL DEFAULT now(),
    -- `sub` trong token của người hỏi.
    asked_by   text NOT NULL,
    app        text NOT NULL,
    documents  text[] NOT NULL,
    question   text NOT NULL,
    -- failed: không trả lời được vì lỗi (mô hình chưa chạy, quá giờ...); lý do nằm ở reason.
    outcome    text NOT NULL CHECK (outcome IN ('answered', 'refused', 'failed')),
    answer     text,
    reason     text,
    citations  jsonb NOT NULL DEFAULT '[]',
    model      text NOT NULL,
    duration_ms integer NOT NULL
);

-- Nhật ký thay đổi (ADR 0009) đưa từng dòng vào chuỗi băm: sửa hay xóa lén một câu hỏi đã ghi thì lệnh kiểm phát hiện.
SELECT core.audit_attach('platform.assistant_questions');

GRANT USAGE ON SCHEMA platform TO assistant;
GRANT INSERT ON platform.assistant_questions TO assistant;

-- migrate:down
REVOKE INSERT ON platform.assistant_questions FROM assistant;
REVOKE USAGE ON SCHEMA platform FROM assistant;
SELECT core.audit_detach('platform.assistant_questions');
DROP TABLE platform.assistant_questions;
