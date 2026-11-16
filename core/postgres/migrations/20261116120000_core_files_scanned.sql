-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Trạng thái quét mã độc của tệp (ADR 0010). files-api quét trước khi lưu và chỉ lưu tệp sạch, nên
-- dòng nó thêm có trạng thái `clean`. Mặc định vẫn là `unscanned`: dòng thêm bằng đường khác, hay tệp
-- tải lên trước khi có bước quét, không bị coi là đã quét.

-- migrate:up
ALTER TABLE core.files DROP CONSTRAINT files_status_check;
ALTER TABLE core.files ADD CONSTRAINT files_status_check CHECK (status IN ('unscanned', 'clean'));

-- migrate:down
UPDATE core.files SET status = 'unscanned' WHERE status = 'clean';
ALTER TABLE core.files DROP CONSTRAINT files_status_check;
ALTER TABLE core.files ADD CONSTRAINT files_status_check CHECK (status IN ('unscanned'));
