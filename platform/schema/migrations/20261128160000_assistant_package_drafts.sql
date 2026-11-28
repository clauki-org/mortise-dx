-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Nhật ký bản nháp cấu hình gói (ADR 0071): mỗi lần quản trị đơn vị nhờ trợ lý soạn bản nháp một dòng, như nhật ký
-- câu hỏi (platform.assistant_questions). Bảng riêng vì bản nháp không thuộc gói nào và có kết quả khác câu hỏi.
-- Không lưu nội dung tệp: bản nháp chỉ trả cho người gọi, dòng ghi đường dẫn tệp và số lỗi để biết đã soạn gì.
-- platform/services/assistant ghi bằng vai trò CSDL `assistant`, chỉ được thêm dòng; quản trị của tenant đọc dòng
-- của tenant mình qua Hasura.

-- migrate:up
CREATE TABLE platform.assistant_package_drafts (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     text NOT NULL REFERENCES core.tenants (id) ON DELETE CASCADE,
    asked_at      timestamptz NOT NULL DEFAULT now(),
    -- `sub` trong token của người gọi.
    asked_by      text NOT NULL,
    need          text NOT NULL,
    -- failed: không trả được bản nháp vì lỗi (mô hình chưa chạy, quá giờ...); lý do nằm ở reason.
    outcome       text NOT NULL CHECK (outcome IN ('drafted', 'invalid', 'refused', 'failed')),
    reason        text,
    files         text[] NOT NULL DEFAULT '{}',
    problem_count integer NOT NULL DEFAULT 0 CHECK (problem_count >= 0),
    -- Mô hình theo cấu hình, như nhật ký câu hỏi: dòng lỗi trước khi gọi được mô hình vẫn ghi yêu cầu lẽ ra đi tới
    -- đâu. model_host null khi chạy tại chỗ.
    model         text NOT NULL,
    model_provider text NOT NULL,
    model_host    text,
    -- Số lượt mô hình đã trả bản nháp; null khi lỗi trước lượt đầu.
    attempts      smallint CHECK (attempts >= 1),
    duration_ms   integer NOT NULL
);

-- Nhật ký thay đổi (ADR 0009) đưa từng dòng vào chuỗi băm, như nhật ký câu hỏi: sửa hay xóa lén một dòng thì lệnh
-- kiểm phát hiện.
SELECT core.audit_attach('platform.assistant_package_drafts');

GRANT INSERT ON platform.assistant_package_drafts TO assistant;

-- migrate:down
REVOKE INSERT ON platform.assistant_package_drafts FROM assistant;
SELECT core.audit_detach('platform.assistant_package_drafts');
DROP TABLE platform.assistant_package_drafts;
