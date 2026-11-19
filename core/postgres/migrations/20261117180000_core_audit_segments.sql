-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Đoạn nhật ký thay đổi đã xuất sang kho lạnh (ADR 0014): mỗi dòng là một tệp Parquet trên SeaweedFS chứa các dòng
-- core.audit_log từ first_id tới last_id. Ghi lại băm đầu và băm cuối để chuỗi băm nối được qua ranh giới giữa kho
-- lạnh và CSDL, và băm của tệp để phát hiện tệp bị thay. core/cold-archive ghi bảng này sau khi đã đọc lại tệp và
-- tính lại băm từng dòng.

-- migrate:up
CREATE TABLE core.audit_segments (
    id          bigserial PRIMARY KEY,
    first_id    bigint NOT NULL,
    last_id     bigint NOT NULL,
    -- prev_hash của dòng đầu đoạn: bằng last_hash của đoạn trước, hay rỗng nếu là đầu chuỗi.
    first_prev  bytea NOT NULL,
    last_hash   bytea NOT NULL UNIQUE,
    rows        bigint NOT NULL CHECK (rows > 0),
    -- Khóa của tệp trong bucket kho lạnh, ví dụ audit_log/1-5000.parquet.
    object_key  text NOT NULL UNIQUE,
    file_sha256 bytea NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CHECK (first_id <= last_id),
    -- Đoạn không chồng nhau: đoạn sau bắt đầu sau đoạn trước.
    EXCLUDE USING gist (int8range(first_id, last_id, '[]') WITH &&)
);

-- Như chính nhật ký: chỉ được thêm. Sửa hay xóa một đoạn là làm mất dấu vết của dữ liệu đã chuyển đi.
CREATE TRIGGER audit_segments_append_only BEFORE UPDATE OR DELETE ON core.audit_segments
    FOR EACH ROW EXECUTE FUNCTION core.audit_refuse();
CREATE TRIGGER audit_segments_no_truncate BEFORE TRUNCATE ON core.audit_segments
    FOR EACH STATEMENT EXECUTE FUNCTION core.audit_refuse();

-- migrate:down
DROP TABLE core.audit_segments;
